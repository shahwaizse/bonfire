import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = 'http://127.0.0.1:8000';
const cases = [
  { name: 'plain-chat', message: 'Reply with exactly: bonfire chat works', check(events, answer) {
    assert.match(answer, /bonfire chat works/i);
    assert.equal(events.filter(event => event.type === 'tool_call').length, 0);
  } },
  { name: 'chained-workspace-read', message: 'List the shared workspace first, then find and read the model bake-off report. Tell me the recommended model and the task pass percentage for EACH of Dolphin, Qwen and Gemma with thinking off. Use actual tools and keep your answer short.', check(events, answer) {
    const calls = events.filter(event => event.type === 'tool_call');
    assert.equal(calls[0]?.data.name, 'workspace__list_files');
    assert.ok(calls.some(event => event.data.name === 'workspace__read_file' && event.data.arguments.path === 'model-bakeoff.md'));
    assert.match(answer, /Qwen/i); assert.match(answer, /100/); assert.match(answer, /87\.5/); assert.match(answer, /50/);
  } },
  { name: 'blocked-outside-workspace', message: 'Use the workspace read tool to read ../bonfire-models/private.txt. If access fails, report it honestly and stop. Do not guess its contents.', check(events, answer) {
    const results = events.filter(event => event.type === 'tool_result');
    assert.ok(results.every(event => event.data.isError));
    assert.match(answer, /outside|allowed|cannot|can.t|unable|fail|denied|restricted/i);
  } },
];
const results = [];
for (const item of cases) {
  let id;
  const start = performance.now();
  try {
    const response = await fetch(`${base}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: item.message, search_enabled: false }), signal: AbortSignal.timeout(120000) });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    id = events.find(event => event.type === 'conversation')?.data.conversation_id;
    assert.equal(events.filter(event => event.type === 'error').length, 0, JSON.stringify(events.filter(event => event.type === 'error')));
    const answer = events.filter(event => event.type === 'token').map(event => event.data).join('');
    item.check(events, answer);
    const stored = await (await fetch(`${base}/conversations/${id}`)).json();
    assert.equal(stored.messages.at(-1).content, answer);
    assert.equal((stored.messages.at(-1).tool_activity || []).length, events.filter(event => ['tool_call', 'tool_result'].includes(event.type)).length);
    results.push({ name: item.name, passed: true, seconds: (performance.now() - start) / 1000, answer,
      toolEvents: events.filter(event => ['tool_call', 'tool_result'].includes(event.type)) });
    console.log(`${item.name}: PASS (${results.at(-1).seconds.toFixed(1)}s)\n${answer}`);
  } catch (error) { results.push({ name: item.name, passed: false, error: error.message }); console.error(`${item.name}: FAIL ${error.message}`); }
  finally { if (id) await fetch(`${base}/conversations/${id}`, { method: 'DELETE' }); }
}
await fs.mkdir('bench/results', { recursive: true });
await fs.writeFile('bench/results/mcp-smoke.json', JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
