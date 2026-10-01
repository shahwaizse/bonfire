// Real-model cross-turn lifecycle smoke test, using two ordinary profiles.
import fs from 'node:fs/promises';
import path from 'node:path';
const api = 'http://127.0.0.1:8000';
const root = path.resolve(process.platform === 'win32' ? 'D:/Projects/bonfire-harness-bench' : '/tmp/bonfire-harness-bench', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(root, { recursive: true });
const request = async (route, method = 'GET', body) => {
  const response = await fetch(api + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw Error(`${route}: ${response.status} ${await response.text()}`);
  return response.json();
};
async function chat(agentId, message, conversationId) {
  const start = performance.now(), events = []; let buffer = '', id = conversationId, answer = '';
  const response = await fetch(api + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: agentId, message, conversation_id: conversationId, search_enabled: false }), signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw Error(await response.text());
  const decoder = new TextDecoder();
  const consume = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'conversation') id = event.data.conversation_id;
    if (event.type === 'token') answer += event.data;
    if (event.type.startsWith('tool_') || event.type === 'error') events.push(event);
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true }); let index;
    while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
  }
  consume(buffer + decoder.decode());
  return { conversation_id: id, message, answer, events, seconds: (performance.now() - start) / 1000 };
}
const results = [];
const profiles = [
  { name: 'Harness bench helper', instructions: 'Help with assigned files and run requested commands. Be brief.' },
  { name: 'Harness bench robot', instructions: 'You are a friendly little robot. Help the owner with computer tasks. Be concise.' },
];
const template = (await request('/little-guys')).find(guy => guy.name === 'FilePal');
if (!template) throw Error('A mascot template is needed');
for (let index = 0; index < profiles.length; index++) {
  const directory = path.join(root, `profile-${index}`), port = 3021 + index;
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'server.cjs'), `require('node:http').createServer((req,res)=>res.end('Harness demo')).listen(${port},'127.0.0.1',()=>console.log('Ready ${port}'));\n`);
  const folder = await request('/file-folders', 'POST', { name: profiles[index].name, path: directory });
  const profile = await request('/little-guys', 'POST', { ...profiles[index], tagline: 'Temporary harness benchmark', mascot: template.mascot, allowed_apps: [], allowed_tools: ['files__list_folders', 'files__read_file', 'files__run_command'], folder_access: [{ folder_id: folder.id, mode: 'write' }] });
  const record = { profile: profiles[index], port, agent_id: profile.id, folder_id: folder.id };
  try {
    record.start = await chat(profile.id, `Start server.cjs in my assigned folder as a persistent app, and check that http://127.0.0.1:${port}/ serves Harness demo. Don't install anything or edit files.`);
    try { record.http_started = (await (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) })).text()) === 'Harness demo'; } catch { record.http_started = false; }
    record.model_http_verified = record.start.events.some(event => event.type === 'tool_result' && !event.data.isError && (
      event.data.name === 'read_webpage' && event.data.summary?.includes('Harness demo') ||
      event.data.name === 'files__run_command' && /Harness demo|\btrue\b/.test(event.data.evidence?.output || '') && record.start.events.some(call => call.type === 'tool_call' && call.data.id === event.data.id && call.data.arguments?.command?.includes('fetch('))
    ));
    console.log(JSON.stringify({ profile: profiles[index].name, phase: 'start', seconds: record.start.seconds, passed: record.http_started, answer: record.start.answer }));
    record.stop = await chat(profile.id, 'Thanks, turn that app off now and verify it stopped.', record.start.conversation_id);
    try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) }); record.http_stopped = false; } catch { record.http_stopped = true; }
    record.lifecycle_passed = record.http_started && record.http_stopped && record.stop.events.some(event => event.type === 'tool_call' && event.data.arguments?.mode === 'stop') && ![...record.start.events, ...record.stop.events].some(event => event.type === 'error');
    record.passed = record.lifecycle_passed && record.model_http_verified;
    console.log(JSON.stringify({ profile: profiles[index].name, phase: 'stop', seconds: record.stop.seconds, passed: record.passed, answer: record.stop.answer }));
  } catch (error) { record.error = error.message; }
  finally {
    // Stop any benchmark-owned managed processes before removing their permissions.
    const { managedCommand } = await import('../src/managed-commands.js');
    const listed = await managedCommand({ mode: 'status', folder_id: folder.id }, directory, { agentId: profile.id });
    for (const process of listed.processes.filter(item => item.running)) await managedCommand({ mode: 'stop', folder_id: folder.id, process_id: process.process_id }, directory, { agentId: profile.id });
    await request(`/little-guys/${profile.id}`, 'DELETE');
    await request(`/file-folders/${folder.id}`, 'DELETE');
    if (record.start?.conversation_id) await request(`/conversations/${record.start.conversation_id}`, 'DELETE');
  }
  results.push(record);
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
}
console.log(JSON.stringify({ passed: results.filter(record => record.passed).length, total: results.length, report: path.join(root, 'results.json') }));
