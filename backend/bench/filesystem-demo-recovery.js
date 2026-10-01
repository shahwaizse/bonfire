// Follow-up test on model-written artifacts. Does not hand-edit or launch the demo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { filesystemSchemas } from '../src/filesystem-tools.js';
const root = path.resolve(process.argv[2]);
const base = 'http://127.0.0.1:8000';
async function api(route, body) { const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw Error(result.detail); return result; }
const folder = await api('/file-folders', { name: 'Little Guy Counter demo', path: root });
const guy = await api('/little-guys', { name: 'FilePal', tagline: 'A little guy with actual files to poke at', instructions: 'Work on files and run requested commands with assigned native tools. Read existing files before editing and preserve unrelated contents. Be brief and report verified results.', allowed_tools: filesystemSchemas.map(tool => tool.function.name), allowed_apps: [], folder_access: [{ folder_id: folder.id, mode: 'write' }], mascot: { body: 'robot', eyes: 'round', mouth: 'grin', accessory: 'antenna', pattern: 'spots', palette: 'amethyst', seed: 3011 } });
const prompt = 'The website has already been written in your assigned folder. Launch server.cjs using Bash from that folder, then verify http://127.0.0.1:3011 returns HTTP 200 and Little Guy Counter. Use Node built-in fetch, not a package. No files need regeneration. If launch fails, inspect server.log and fix the actual problem. End with the verified URL.';
const started = performance.now(); let first = null, content = '', buffer = '', chatId;
const events = [], errors = []; const decoder = new TextDecoder();
const response = await fetch(base + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: prompt, agent_id: guy.id, search_enabled: false }), signal: AbortSignal.timeout(180000) });
const consume = line => {
  if (!line.trim()) return; const event = JSON.parse(line), at_ms = performance.now() - started;
  if (event.type === 'conversation') chatId = event.data.conversation_id;
  if (event.type === 'token') { content += event.data; if (first === null && event.data.trim()) first = at_ms; }
  if (event.type === 'error') errors.push(event.data);
  if (event.type.startsWith('tool_')) { events.push({ type: event.type, ...event.data, at_ms }); console.log(JSON.stringify(events.at(-1))); }
};
for await (const chunk of response.body) { buffer += decoder.decode(chunk, { stream: true }); let i; while ((i = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } }
consume(buffer + decoder.decode());
const result = { prompt, root, guy_id: guy.id, folder_id: folder.id, conversation_id: chatId, ttft_ms: first, total_ms: performance.now() - started, answer: content, errors, events };
try { const response = await fetch('http://127.0.0.1:3011', { signal: AbortSignal.timeout(5000) }); const html = await response.text(); result.http_200 = response.status === 200; result.serves_own_artifact = html === await fs.readFile(path.join(root, 'index.html'), 'utf8'); } catch { result.http_200 = false; }
result.passed = !errors.length && result.http_200 && result.serves_own_artifact && events.some(event => event.type === 'tool_result' && event.name === 'files__run_command' && !event.isError);
await fs.writeFile(path.join(root, 'recovery-results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: result.passed, seconds: result.total_ms / 1000, ttft_seconds: first / 1000, answer: content, errors, chat_url: `http://127.0.0.1:3000/?chat=${chatId}` }));
