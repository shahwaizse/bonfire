import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceFromResult, buildToolEvidence } from '../src/tool-evidence.js';
import { runToolLoop } from '../src/tool-loop.js';

test('file evidence omits source bodies and remains permission scoped', () => {
  const evidence = evidenceFromResult('files__read_file', { folder_id: 'folder', path: 'a.js' }, {}, [{ content: 'private source', sha256: 'hash', next_line: 20 }]);
  assert.equal(evidence.content, undefined);
  const messages = [{ tool_activity: JSON.stringify([
    { type: 'tool_call', data: { id: '1', name: 'files__read_file', arguments: { folder_id: 'folder' } } },
    { type: 'tool_result', data: { id: '1', name: 'files__read_file', evidence } },
  ]) }];
  assert.match(buildToolEvidence(messages, ['files__read_file'], [{ folder_id: 'folder' }]), /hash/);
  assert.equal(buildToolEvidence(messages, [], [{ folder_id: 'folder' }]), '');
  assert.equal(buildToolEvidence(messages, ['files__read_file'], []), '');
});

test('legacy complete summaries recover command evidence', () => {
  const messages = [{ tool_activity: [
    { type: 'tool_call', data: { id: '1', name: 'files__run_command', arguments: { folder_id: 'folder', path: '.', command: 'ps aux' } } },
    { type: 'tool_result', data: { id: '1', name: 'files__run_command', isError: true, summary: JSON.stringify({ data: { exit_code: 1, output: '', cwd: 'somewhere' } }) } },
  ] }];
  assert.match(buildToolEvidence(messages, ['files__run_command'], [{ folder_id: 'folder' }]), /"exit_code":1/);
});

test('unchanged failed calls do not execute twice; changed arguments can recover', async () => {
  const name = 'files__run_command'; let executions = 0, turn = 0;
  const commands = ['lsof', 'lsof', 'native alternative'];
  const results = [];
  const registry = { catalog: async () => [{ function: { name } }], call: async (_name, args) => {
    executions++;
    return { isError: args.command === 'lsof', content: [{ type: 'text', text: args.command === 'lsof' ? 'command not found' : 'Verified' }] };
  } };
  await runToolLoop([], { registry, emit: (type, data) => { if (type === 'tool_result') results.push(data); }, streamTurn: async function* () {
    if (turn === commands.length) { yield { delta: { content: 'Done' }, finish_reason: 'stop' }; return; }
    const index = turn++;
    yield { delta: { tool_calls: [{ index: 0, id: `call-${index}`, function: { name, arguments: JSON.stringify({ command: commands[index] }) } }] }, finish_reason: 'tool_calls' };
  } });
  assert.equal(executions, 2); assert.match(results[1].summary, /already failed/); assert.equal(results[2].isError, false);
});

test('one unchanged retry is permitted for transient connection errors', async () => {
  let executions = 0, turn = 0;
  await runToolLoop([], { emit: () => {}, registry: { isReadOnly: () => true, catalog: async () => [{ function: { name: 'remote' } }], call: async () => {
    executions++; return { isError: executions === 1, content: [{ type: 'text', text: executions === 1 ? 'ECONNRESET' : 'ok' }] };
  } }, streamTurn: async function* () {
    if (turn === 2) { yield { delta: { content: 'Done' }, finish_reason: 'stop' }; return; }
    yield { delta: { tool_calls: [{ index: 0, id: `c${turn++}`, function: { name: 'remote', arguments: '{}' } }] }, finish_reason: 'tool_calls' };
  } });
  assert.equal(executions, 2);
});
