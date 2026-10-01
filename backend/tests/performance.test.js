import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireInference } from '../src/inference-scheduler.js';
import { buildSystemPrompt, selectTokenHistory } from '../src/prompting.js';
import { shouldPrefetchWeb } from '../src/search-context.js';
import { GuyTools } from '../src/little-guys.js';
import { runToolLoop } from '../src/tool-loop.js';
import { ResultCache } from '../src/result-cache.js';
import { compactMachineStatus } from '../src/machine-status.js';

test('queued chat runs before optional generation and cancelled work is removed', async () => {
  const release = await acquireInference(); const order = [];
  const background = acquireInference({ priority: 10 }).then(done => { order.push('background'); done(); });
  const chat = acquireInference().then(done => { order.push('chat'); done(); });
  const controller = new AbortController();
  const cancelled = acquireInference({ signal: controller.signal }); controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' }); release(); await Promise.all([background, chat]);
  assert.deepEqual(order, ['chat', 'background']);
});
test('token history uses measured tokens and preserves the latest user input', async () => {
  const history = [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'reply' }, { role: 'user', content: 'latest' }];
  assert.deepEqual(await selectTokenHistory(history, async text => text.length, { budget: 20 }), [{ role: 'user', content: 'latest' }]);
  assert.deepEqual(await selectTokenHistory(history, async () => 100, { budget: 1 }), [{ role: 'user', content: 'latest' }]);
});
test('instructions omit unavailable capabilities and put dynamic date last', () => {
  const prompt = buildSystemPrompt({ allowedTools: [], guy: { name: 'Watcher', tagline: '', instructions: 'Watch things.' } });
  assert.doesNotMatch(prompt, /For requested pictures|Launch only/);
  assert.match(prompt, /Watch things/); assert.match(prompt, /Current local date:.*\.$/);
});
test('web prefetch only covers changing facts or verification, respecting offline requests', () => {
  for (const text of ['Explain RAM.', 'Write Python median code.', 'Using only these numbers, compare current results.', 'Do not search; explain current transformers.']) assert.equal(shouldPrefetchWeb(text), false);
  for (const text of ['What is the latest llama.cpp release?', 'Verify Brave pricing.', 'What is the weather today?']) assert.equal(shouldPrefetchWeb(text), true);
});
test('combined machine status is available only with both existing read permissions', async () => {
  const tools = { catalog: async () => ['machine__get_machine_snapshot', 'machine__get_inference_stats', 'machine__get_status'].map(name => ({ type: 'function', function: { name } })) };
  const all = new GuyTools(tools, { allowed_tools: ['machine__get_machine_snapshot', 'machine__get_inference_stats'] }, []);
  assert.equal((await all.catalog()).length, 3);
  const limited = new GuyTools(tools, { allowed_tools: ['machine__get_machine_snapshot'] }, []);
  assert.deepEqual((await limited.catalog()).map(tool => tool.function.name), ['machine__get_machine_snapshot']);
});
test('independent read-only calls overlap and transcript keeps call order', async () => {
  let active = 0, maximum = 0;
  const registry = { catalog: async () => ['one', 'two'].map(name => ({ type: 'function', function: { name } })), isReadOnly: () => true,
    call: async name => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, name === 'one' ? 15 : 5)); active--; return { content: [{ type: 'text', text: JSON.stringify({ name }) }] }; } };
  let turn = 0;
  async function* streamTurn(messages) {
    if (turn++ === 0) { yield { delta: { tool_calls: ['one', 'two'].map((name, index) => ({ index, id: `call_${index}`, function: { name, arguments: '{}' } })) } }; yield { delta: {}, finish_reason: 'tool_calls' }; }
    else { assert.deepEqual(messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content).data.name), ['one', 'two']); yield { delta: { content: 'Done' } }; yield { delta: {}, finish_reason: 'stop' }; }
  }
  assert.equal(await runToolLoop([], { registry, streamTurn, emit: () => {} }), 'Done'); assert.equal(maximum, 2);
});
test('TTL cache is bounded and returns isolated values', () => {
  const cache = new ResultCache({ maxEntries: 1 }); cache.set('a', { count: 1 });
  cache.get('a').count = 9; assert.equal(cache.get('a').count, 1);
  cache.set('b', { count: 2 }); assert.equal(cache.get('a'), null);
  const expired = new ResultCache({ ttlMs: 0 }); expired.set('x', 1); assert.equal(expired.get('x'), null);
});
test('combined status keeps actual missing readings and sends one concise timing row', () => {
  const hardware = { cpu: { temperature_c: null }, amd_gpus: [{ temperature_c: 60 }], notes: ['CPU unavailable'], windows_gpu_engines: ['verbose counters'] };
  const turn = { completed: true, generation_tokens_per_second: 35, generated_tokens: 40 };
  const result = compactMachineStatus(hardware, { weighted_generation_tokens_per_second: 35, recent_turns: [turn, turn, turn] });
  assert.equal(result.hardware.cpu.temperature_c, null);
  assert.equal(result.hardware.windows_gpu_engines, undefined);
  assert.equal(result.inference.recent_turns.length, 1);
  assert.equal(result.inference.average_over_completed_turns, 3);
});
