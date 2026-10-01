import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2]), agentId = process.argv[3];
const prompt = `Read server.cjs in your assigned folder. Change server.listen(PORT, () => to server.listen(PORT, '127.0.0.1', () => using the file tools, keeping other bytes unchanged.
Then execute these two commands with files__run_command, with path="." for both:
1. nohup node server.cjs > server.log 2>&1 &
2. node -e "fetch('http://127.0.0.1:3011').then(async r=>console.log(r.status,(await r.text()).includes('Little Guy Counter')))"
The first command starts a persistent background server. The second should print 200 true. Do not regenerate files or install anything. Report the actual output.`;
const started = performance.now(); let first = null, content = '', buffer = '', chatId;
const events = [], errors = [], decoder = new TextDecoder();
const response = await fetch('http://127.0.0.1:8000/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: prompt, agent_id: agentId, search_enabled: false }), signal: AbortSignal.timeout(180000) });
const consume = line => { if (!line.trim()) return; const event = JSON.parse(line), at_ms = performance.now() - started; if (event.type === 'conversation') chatId = event.data.conversation_id; if (event.type === 'token') { content += event.data; if (first === null && event.data.trim()) first = at_ms; } if (event.type === 'error') errors.push(event.data); if (event.type.startsWith('tool_')) { events.push({ type: event.type, ...event.data, at_ms }); console.log(JSON.stringify(events.at(-1))); } };
for await (const chunk of response.body) { buffer += decoder.decode(chunk, { stream: true }); let i; while ((i = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } }
consume(buffer + decoder.decode());
const result = { prompt, root, agent_id: agentId, conversation_id: chatId, ttft_ms: first, total_ms: performance.now() - started, answer: content, errors, events };
try { const response = await fetch('http://127.0.0.1:3011', { signal: AbortSignal.timeout(5000) }); result.http_200 = response.status === 200; result.serves_own_artifact = await response.text() === await fs.readFile(path.join(root, 'index.html'), 'utf8'); } catch { result.http_200 = false; }
result.passed = !errors.length && result.http_200 && result.serves_own_artifact;
await fs.writeFile(path.join(root, 'assisted-results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: result.passed, seconds: result.total_ms / 1000, ttft_seconds: first / 1000, answer: content, errors, chat_url: `http://127.0.0.1:3000/?chat=${chatId}` }));
