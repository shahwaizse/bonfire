// End-to-end app checks. Deletes only chats this script creates; no app launches.
import fs from 'node:fs/promises';
const base = 'http://127.0.0.1:8000';
const out = process.argv[2] || 'D:/Projects/bonfire-latency/optimization/app-performance.json';
const own = new Set(), rows = [];
const guys = await (await fetch(base + '/little-guys')).json();
const watcher = guys.find(guy => guy.allowed_tools.includes('machine__get_machine_snapshot') && guy.allowed_tools.includes('machine__get_inference_stats'));
async function measure(label, message, { id = null, agentId = null, web = false } = {}) {
  const started = performance.now(); let first = null, content = '', errors = [], tools = [], done;
  const response = await fetch(base + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, conversation_id: id, agent_id: agentId, search_enabled: web }), signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Chat HTTP ${response.status}`);
  let buffer = ''; const decoder = new TextDecoder();
  function consume(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'conversation') { id = event.data.conversation_id; own.add(id); }
    if (event.type === 'token') { content += event.data; if (first === null && event.data.trim()) first = performance.now() - started; }
    if (event.type === 'error') errors.push(event.data);
    if (event.type === 'tool_call' || event.type === 'tool_result') tools.push({ type: event.type, ...event.data, at_ms: performance.now() - started });
    if (event.type === 'done') done = event.data;
  }
  for await (const chunk of response.body) { buffer += decoder.decode(chunk, { stream: true }); let i; while ((i = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } }
  consume(buffer + decoder.decode());
  const total = performance.now() - started;
  const persisted = await (await fetch(base + '/conversations/' + id)).json();
  const saved = persisted.messages.at(-1);
  const row = { label, ttft_ms: first, total_ms: total, tools, errors, content, done,
    persisted_matches_stream: saved?.role === 'assistant' && saved.content === content && saved.id === done?.assistant_message_id };
  rows.push(row); console.log(JSON.stringify({ ...row, content: content.slice(0, 120), tools: tools.map(tool => ({ type: tool.type, name: tool.name, at_ms: Math.round(tool.at_ms), isError: tool.isError })) }));
  if (errors.length || !row.persisted_matches_stream || !content.trim()) throw new Error(`App check failed: ${label}`);
  return id;
}
try {
  for (let i = 0; i < 3; i++) {
    const id = await measure('new-chat', 'Explain what RAM does in one short sentence. No tools needed.');
    await measure('followup', 'Now explain VRAM in one short sentence. No tools needed.', { id });
    await measure('workspace-tool', 'Use the shared workspace list-files tool and report the number of files in one short sentence. Do not read the files.');
    if (watcher) await measure('machine-tool', 'Use one combined status tool to give GPU temperature and recorded inference speed. Two short sentences; do not run a new benchmark.', { agentId: watcher.id });
  }
  await measure('web-on-timeless', 'Without searching, explain RAM in one short sentence. No tools needed.', { web: true });
} finally {
  for (const id of own) await fetch(base + '/conversations/' + id, { method: 'DELETE' }).catch(() => {});
  await fs.writeFile(out, JSON.stringify({ measured_at: new Date().toISOString(), rows }, null, 2));
}
