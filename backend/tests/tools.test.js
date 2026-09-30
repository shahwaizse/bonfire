import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCompletionStream } from '../src/llama.js';
import { runToolLoop } from '../src/tool-loop.js';
import { McpRegistry } from '../src/mcp.js';
import { BACKEND_DIR } from '../src/config.js';

const schema = { type: 'function', function: { name: 'workspace__read_file', parameters: { type: 'object' } } };
function turnStream(turns, inspect = () => {}) {
  let index = 0;
  return async function* (messages) { inspect(messages, index); yield* turns[index++]; };
}
function toolTurn(name = schema.function.name, args = '{"path":"welcome.txt"}') {
  return [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name, arguments: args } }] } }, { delta: {}, finish_reason: 'tool_calls' }];
}
const answerTurn = [{ delta: { content: 'Verified answer.' } }, { delta: {}, finish_reason: 'stop' }];
function setup(call = async () => ({ content: [{ type: 'text', text: 'Actual result' }] })) {
  const events = [];
  return { events, options: { registry: { catalog: async () => [schema], call }, emit: (type, data) => events.push({ type, data }) } };
}

test('SSE handles one-byte chunks, UTF-8, fragmented arguments, and trailing frame', async () => {
  const frames = [{ choices: [{ delta: { content: 'مرحبا' } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }];
  const bytes = new TextEncoder().encode(frames.map(frame => `data: ${JSON.stringify(frame)}`).join('\r\n\r\n'));
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const choices = [];
  for await (const choice of parseCompletionStream(stream)) choices.push(choice);
  assert.equal(choices[0].delta.content, 'مرحبا');
  assert.equal(choices[1].delta.tool_calls[0].function.arguments, '{"path":');
  assert.equal(choices[2].finish_reason, 'tool_calls');
});
test('malformed SSE fails explicitly', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {broken}\n')); controller.close(); } });
  await assert.rejects(async () => { for await (const _ of parseCompletionStream(stream)) {} }, SyntaxError);
});
test('native tool call receives actual result before next model turn', async () => {
  const { options, events } = setup();
  const answer = await runToolLoop([{ role: 'user', content: 'Read file' }], { ...options,
    streamTurn: turnStream([toolTurn(), answerTurn], (messages, index) => {
      if (index === 1) { assert.equal(messages.at(-1).role, 'tool'); assert.match(messages.at(-1).content, /Actual result/); assert.equal(messages.at(-2).tool_calls[0].id, 'call_1'); }
    }) });
  assert.equal(answer, 'Verified answer.');
  assert.deepEqual(events.map(event => event.type), ['tool_call', 'tool_result', 'status', 'token']);
});
test('fragmented native function name and arguments are assembled', async () => {
  const { options } = setup(async (name, args) => { assert.equal(name, schema.function.name); assert.deepEqual(args, { path: 'welcome.txt' }); return { content: [] }; });
  const fragmented = [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'workspace__', arguments: '{"path":' } }] } },
    { delta: { tool_calls: [{ index: 0, function: { name: 'read_file', arguments: '"welcome.txt"}' } }] } }, { delta: {}, finish_reason: 'tool_calls' }];
  await runToolLoop([], { ...options, streamTurn: turnStream([fragmented, answerTurn]) });
});
test('unknown/write tools never execute and return an error to the model', async () => {
  const { options, events } = setup(() => { assert.fail('Should never execute'); });
  await runToolLoop([], { ...options, streamTurn: turnStream([toolTurn('files_write'), answerTurn]) });
  assert.equal(events.find(event => event.type === 'tool_result').data.isError, true);
});
test('malformed arguments never execute', async () => {
  const { options, events } = setup(() => { assert.fail('Should never execute'); });
  await runToolLoop([], { ...options, streamTurn: turnStream([toolTurn(schema.function.name, '{broken}'), answerTurn]) });
  assert.equal(events.find(event => event.type === 'tool_result').data.isError, true);
});
test('tool failures are returned as evidence and model can recover', async () => {
  const { options, events } = setup(() => { throw new Error('Unavailable'); });
  await runToolLoop([], { ...options, streamTurn: turnStream([toolTurn(), answerTurn]) });
  assert.match(events.find(event => event.type === 'tool_result').data.summary, /Unavailable/);
});
test('step limits stop repeated tool calls', async () => {
  const { options } = setup();
  await assert.rejects(runToolLoop([], { ...options, maxCalls: 1, streamTurn: turnStream([toolTurn(), toolTurn()]) }), /step limit/);
});
test('duplicate call IDs across turns are rejected before execution', async () => {
  let count = 0;
  const { options } = setup(async () => { count++; return { content: [] }; });
  await assert.rejects(runToolLoop([], { ...options, streamTurn: turnStream([toolTurn(), toolTurn()]) }), /duplicate tool call/);
  assert.equal(count, 1);
});
test('disconnect cancellation prevents tool execution', async () => {
  const controller = new AbortController();
  const { options } = setup(() => { assert.fail('Should never execute'); });
  controller.abort();
  await assert.rejects(runToolLoop([], { ...options, signal: controller.signal, streamTurn: turnStream([toolTurn()]) }), { name: 'AbortError' });
});
test('cancellation during model streaming prevents pending tools', async () => {
  const controller = new AbortController();
  const { options } = setup(() => { assert.fail('Should never execute'); });
  async function* streamTurn() { yield toolTurn()[0]; controller.abort(); yield toolTurn()[1]; }
  await assert.rejects(runToolLoop([], { ...options, signal: controller.signal, streamTurn }), { name: 'AbortError' });
});
test('active tool calls receive cancellation and do not start another turn', async () => {
  const controller = new AbortController();
  const { options } = setup(async (_name, _args, { signal }) => {
    assert.equal(signal, controller.signal);
    controller.abort();
    signal.throwIfAborted();
  });
  await assert.rejects(runToolLoop([], { ...options, signal: controller.signal, streamTurn: turnStream([toolTurn()]) }), { name: 'AbortError' });
});
test('long tool output is explicitly marked as truncated', async () => {
  const { options } = setup(async () => ({ content: [{ type: 'text', text: 'z'.repeat(12000) }] }));
  await runToolLoop([], { ...options, streamTurn: turnStream([toolTurn(), answerTurn], (messages, index) => {
    if (index === 1) { const result = JSON.parse(messages.at(-1).content); assert.equal(result.truncated, true); assert.equal(result.content[0].text.length, 6000); }
  }) });
});
test('truncated or incomplete model turns never execute tools', async () => {
  const { options } = setup(() => { assert.fail('Should never execute'); });
  await assert.rejects(runToolLoop([], { ...options, streamTurn: turnStream([toolTurn().slice(0, 1)]) }), /before completing/);
  await assert.rejects(runToolLoop([], { ...options, streamTurn: turnStream([[{ delta: {}, finish_reason: 'length' }]]) }), /token limit/);
});

test('real MCP stdio discovery, schema validation, allowlist, file reads and containment', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp('D:/Projects/bonfire-mcp-test-');
  const root = path.join(directory, 'shared');
  const outside = path.join(directory, 'outside');
  await fs.mkdir(root); await fs.mkdir(outside);
  await fs.writeFile(path.join(root, 'sample.txt'), 'MCP actual fixture');
  await fs.writeFile(path.join(outside, 'private.txt'), 'must not read');
  await fs.symlink(outside, path.join(root, 'escape'), 'junction');
  const registry = new McpRegistry({ servers: [{ name: 'fixture', command: process.execPath,
    args: [path.join(BACKEND_DIR, 'src/mcp-workspace.js')], env: { BONFIRE_MCP_ROOT: root }, allowTools: ['list_files', 'read_file'] }] });
  try {
    assert.equal((await registry.catalog()).length, 2);
    const list = await registry.call('fixture__list_files', { path: '.' });
    assert.match(list.content[0].text, /sample.txt/);
    assert.equal((await registry.call('fixture__read_file', { path: 'sample.txt' })).content[0].text, 'MCP actual fixture');
    await assert.rejects(registry.call('fixture__read_file', { path: 12 }), /Invalid tool arguments/);
    await assert.rejects(registry.call('fixture__read_file', { path: 'sample.txt', surprise: true }), /Invalid tool arguments/);
    await assert.rejects(registry.call('fixture__write_file', { path: 'sample.txt' }), /not allowed/);
    for (const file of ['../outside/private.txt', 'escape/private.txt', 'C:\\Users\\mshah\\bonfire\\backend\\.env', '..\\outside\\private.txt']) {
      const result = await registry.call('fixture__read_file', { path: file });
      assert.equal(result.isError, true, file);
      assert.doesNotMatch(JSON.stringify(result), /must not read/);
    }
    await fs.writeFile(path.join(root, 'large.txt'), 'a'.repeat(24001));
    assert.equal((await registry.call('fixture__read_file', { path: 'large.txt' })).isError, true);
  } finally {
    await registry.close();
    await fs.unlink(path.join(root, 'escape'));
    assert.ok(path.resolve(directory).toLowerCase().startsWith(path.resolve('D:/Projects/bonfire-mcp-test-').toLowerCase()));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test('an unavailable MCP server does not block plain chats', async () => {
  const registry = new McpRegistry({ servers: [{ name: 'broken', command: 'bonfire-nonexistent-command', allowTools: [] }] });
  try { assert.deepEqual(await registry.catalog(), []); assert.equal(registry.status[0].connected, false); }
  finally { await registry.close(); }
});
