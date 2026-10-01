import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { filesystemCorpus, codingPrompt } from './filesystem-corpus.js';
import { filesystemSchemas } from '../src/filesystem-tools.js';
import { inferenceStatsPath } from '../src/inference-stats.js';
import { buildSystemPrompt } from '../src/prompting.js';

const base = 'http://127.0.0.1:8000';
const label = process.argv[2] || 'baseline';
const repeats = Number(process.argv[3] || 2);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = path.resolve(`D:/Projects/bonfire-files-bench/${stamp}-${label}`);
// Never attribute another app's HTTP response to the generated demo.
await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', () => reject(Error('Port 3011 is busy. Stop the previous counter demo before running this corpus.')));
  probe.listen(3011, '127.0.0.1', () => probe.close(resolve));
});
await fs.mkdir(root, { recursive: true });
const output = path.join(root, 'results.json');
const rows = [], ownGuys = [], ownChats = [], ownFolders = [];
async function api(route, body, method = 'POST') {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(`${route}: ${result.detail}`); return result;
}
const profile = (folder, readOnly) => ({ name: readOnly ? 'FileBench read only' : 'FileBench', tagline: 'Local filesystem benchmark', instructions: 'Complete requested file work using assigned native tools. Discover folder IDs with list_folders. Read existing files before editing and use the returned current hash. Preserve unrelated text. Report only verified outcomes, briefly.', allowed_tools: filesystemSchemas.map(tool => tool.function.name), allowed_apps: [], folder_access: [{ folder_id: folder.id, mode: readOnly ? 'read' : 'write' }], mascot: { body: 'robot', eyes: 'round', mouth: 'smile', accessory: 'antenna', pattern: 'plain', palette: 'amethyst', seed: 4719 } });
async function stats() { try { return JSON.parse(await fs.readFile(inferenceStatsPath, 'utf8')); } catch { return []; } }
async function measure(id, prompt, agentId, conversationId = null) {
  const before = new Set((await stats()).map(turn => turn.id));
  const started = performance.now(); let firstToken = null, firstTool = null, content = '', buffer = '', chatId = conversationId;
  const events = [], errors = []; const decoder = new TextDecoder();
  const response = await fetch(base + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: prompt, agent_id: agentId, conversation_id: conversationId, search_enabled: false }), signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw Error(`Chat HTTP ${response.status}`);
  const consume = line => {
    if (!line.trim()) return; const event = JSON.parse(line), at_ms = performance.now() - started;
    if (event.type === 'conversation') { chatId = event.data.conversation_id; ownChats.push(chatId); }
    if (event.type === 'token') { content += event.data; if (firstToken === null && event.data.trim()) firstToken = at_ms; }
    if (event.type === 'error') errors.push(event.data);
    if (event.type === 'tool_call' && firstTool === null) firstTool = at_ms;
    if (['tool_call', 'tool_result', 'status'].includes(event.type)) events.push({ type: event.type, ...typeof event.data === 'object' ? event.data : { value: event.data }, at_ms });
  };
  let transportError;
  try {
    for await (const chunk of response.body) { buffer += decoder.decode(chunk, { stream: true }); let index; while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); } }
    consume(buffer + decoder.decode());
  } catch (error) { transportError = error.message; errors.push(error.message); }
  const elapsed = performance.now() - started;
  // Let the asynchronous metrics writer flush; this wait is outside the measured request.
  await new Promise(resolve => setTimeout(resolve, 100));
  const timings = (await stats()).filter(turn => !before.has(turn.id));
  return { id, prompt, conversation_id: chatId, ttft_ms: firstToken, first_tool_ms: firstTool, total_ms: elapsed, answer: content, errors, transport_error: transportError, events, model_turns: timings };
}
async function seed(relative, files) {
  for (const [name, content] of Object.entries(files)) { const target = path.join(root, relative, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }
  await fs.mkdir(path.join(root, relative), { recursive: true });
}
async function judge(item, relative, row) {
  const checks = {};
  checks.no_request_error = !row.errors.length;
  if (item.answer) checks.answer = item.answer.test(row.answer);
  for (const name of item.required || []) checks[`called:${name}`] = row.events.some(event => event.type === 'tool_call' && event.name === name);
  if (item.evidenceAny) checks.evidence = row.events.some(event => event.type === 'tool_result' && item.evidenceAny.includes(event.name));
  const expected = item.unchanged ? item.files : item.expected || {};
  for (const [name, content] of Object.entries(expected)) {
    try { checks[`file:${name}`] = await fs.readFile(path.join(root, relative, name), 'utf8') === content; } catch { checks[`file:${name}`] = false; }
  }
  for (const name of item.absent || []) { try { await fs.access(path.join(root, relative, name)); checks[`absent:${name}`] = false; } catch { checks[`absent:${name}`] = true; } }
  if (item.expectedNoWrite || item.unchanged) checks.no_write_attempt = !row.events.some(event => event.type === 'tool_call' && /files__(?:write|edit|run|create|restore)/.test(event.name));
  if (item.expectedError) checks.expected_tool_error = row.events.some(event => event.type === 'tool_result' && event.isError);
  return { ...row, category: item.id, checks, passed: Object.values(checks).every(Boolean) };
}
async function record(row) {
  rows.push(row);
  await fs.writeFile(output, JSON.stringify({ measured_at: new Date().toISOString(), label, model: 'Gemma 4 E4B Q4_K_M', repeats, root, rows }, null, 2));
  console.log(JSON.stringify({ id: row.id, passed: row.passed, seconds: Math.round(row.total_ms / 100) / 10, ttft_seconds: row.ttft_ms === null ? null : Math.round(row.ttft_ms / 100) / 10, calls: row.events.filter(event => event.type === 'tool_call').map(event => event.name), failed_checks: Object.entries(row.checks || {}).filter(([, value]) => !value).map(([key]) => key), errors: row.errors }));
}
let folder, guy, reader;
try {
  folder = await api('/file-folders', { name: `FileBench ${stamp}`, path: root }); ownFolders.push(folder.id);
  guy = await api('/little-guys', profile(folder, false)); ownGuys.push(guy.id);
  reader = await api('/little-guys', profile(folder, true)); ownGuys.push(reader.id);
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ label, repeats, model: await (await fetch(base + '/health')).json().then(value => ({ name: value.model })), guy: profile(folder, false), system: buildSystemPrompt({ guy, webEnabled: false, allowedTools: guy.allowed_tools }), schemas: filesystemSchemas, cases: filesystemCorpus.map(item => ({ ...item, answer: item.answer?.source })), coding_prompt: codingPrompt }, null, 2));
  for (let repetition = 1; repetition <= repeats; repetition++) for (const item of filesystemCorpus) {
    const relative = `${item.id}-r${repetition}`; await seed(relative, item.files);
    const row = await measure(relative, item.prompt.replaceAll('CASE_PATH', relative), item.readOnly ? reader.id : guy.id);
    await record(await judge(item, relative, row));
  }
  // Explicit multi-turn recovery test: the model must use its actual backup ID.
  const relative = 'restore'; await seed(relative, { 'draft.txt': 'Version one\n' });
  const edit = await measure('restore-edit', `Read ${relative}/draft.txt, replace Version one with Version two, preserving its final newline. Report the actual backup ID.`, guy.id);
  await record(await judge({ id: 'restore-edit', expected: { 'draft.txt': 'Version two\n' } }, relative, edit));
  const restore = await measure('restore-undo', 'Undo the last file change using its backup ID. Read the current file to get its hash before restoring. Briefly report the result.', guy.id, edit.conversation_id);
  await record(await judge({ id: 'restore-undo', expected: { 'draft.txt': 'Version one\n' }, required: ['files__restore_file'] }, relative, restore));
  const demo = 'counter-demo'; await seed(demo, {});
  const row = await measure('coding-demo', codingPrompt.replaceAll('CASE_PATH', demo), guy.id);
  const checks = { no_request_error: !row.errors.length, wrote_file: row.events.some(event => event.type === 'tool_result' && event.name === 'files__write_file' && !event.isError), ran_bash: row.events.some(event => event.type === 'tool_result' && event.name === 'files__run_command' && !event.isError) };
  for (const name of ['index.html', 'server.cjs']) { try { await fs.access(path.join(root, demo, name)); checks[`file:${name}`] = true; } catch { checks[`file:${name}`] = false; } }
  try { const response = await fetch('http://127.0.0.1:3011', { signal: AbortSignal.timeout(5000) }); const html = await response.text(); checks.http_200 = response.status === 200; checks.title = html.includes('Little Guy Counter'); checks.http_own_artifact = html === await fs.readFile(path.join(root, demo, 'index.html'), 'utf8'); checks.html_css_js = /<style[\s>]/i.test(html) && /<script[\s>]/i.test(html) && /id=["']increment["']/.test(html) && /id=["']count["']/.test(html); } catch { checks.http_200 = false; }
  await record({ ...row, category: 'coding-demo', checks, passed: Object.values(checks).every(Boolean) });
  // Plain chat references distinguish output latency from filesystem action latency.
  for (let i = 1; i <= 3; i++) {
    const row = await measure(`plain-reference-${i}`, 'Explain what RAM does in one short sentence. No tools needed.', null);
    await record({ ...row, category: 'plain-reference', checks: { no_error: !row.errors.length, answered: /memory/i.test(row.answer) }, passed: !row.errors.length && /memory/i.test(row.answer) });
  }
} finally {
  for (const id of ownGuys) await api('/little-guys/' + id, null, 'DELETE').catch(() => {});
  for (const id of ownFolders) await api('/file-folders/' + id, null, 'DELETE').catch(() => {});
  for (const id of ownChats) await api('/conversations/' + id, null, 'DELETE').catch(() => {});
  console.log('RESULTS=' + output);
}
