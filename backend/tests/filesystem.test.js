import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileFolders } from '../src/file-folders.js';
import { FilesystemTools } from '../src/filesystem-tools.js';
import { GuyTools } from '../src/little-guys.js';
import { AppTools } from '../src/app-tools.js';

const root = path.resolve(process.platform === 'win32' ? 'D:/Projects/bonfire-files-tests' : '/tmp/bonfire-files-tests', `${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const folder = await fileFolders.add({ name: 'Filesystem primitives test', path: root });
const tools = new FilesystemTools();
const options = { folderAccess: [{ folder_id: folder.id, mode: 'write' }], agentId: 'primitive-tests' };
const call = async (name, args, override = options) => JSON.parse((await tools.call(`files__${name}`, { folder_id: folder.id, ...args }, override)).content[0].text);
let backup;
test.after(async () => { await fileFolders.remove(folder.id); });

test('UTF-8 create/read and verified hash', async () => {
  const write = await call('write_file', { path: 'note.txt', content: 'Hello دنیا 🔥\nSecond line' });
  assert.equal(write.created, true); assert.match(write.sha256, /^[a-f0-9]{64}$/);
  const read = await call('read_file', { path: 'note.txt' });
  assert.match(read.content, /دنیا 🔥/); assert.equal(read.sha256, write.sha256);
});
test('existing files require a current hash', async () => {
  await assert.rejects(call('write_file', { path: 'note.txt', content: 'overwrite' }), /expected_hash/);
});
test('exact edit preserves other contents and creates restorable backup', async () => {
  const current = await call('read_file', { path: 'note.txt' });
  const changed = await call('edit_file', { path: 'note.txt', expected_hash: current.sha256, edits: [{ old_text: 'Second line', new_text: 'Revised line' }] });
  backup = changed.backup_id;
  assert.equal((await fs.readFile(path.join(root, 'note.txt'), 'utf8')), 'Hello دنیا 🔥\nRevised line');
  assert.equal(changed.before_sha256, current.sha256);
});
test('stale hash rejects an edit without modifying disk', async () => {
  const before = await fs.readFile(path.join(root, 'note.txt'), 'utf8');
  await assert.rejects(call('edit_file', { path: 'note.txt', expected_hash: '0'.repeat(64), edits: [{ old_text: 'Revised', new_text: 'Bad' }] }), /changed/);
  assert.equal(await fs.readFile(path.join(root, 'note.txt'), 'utf8'), before);
});
test('restore previous contents using backup', async () => {
  const current = await call('read_file', { path: 'note.txt' });
  await call('restore_file', { path: 'note.txt', backup_id: backup, expected_hash: current.sha256 });
  assert.match(await fs.readFile(path.join(root, 'note.txt'), 'utf8'), /Second line/);
});
test('restore rejects a mismatched optional path', async () => {
  const current = await call('read_file', { path: 'note.txt' });
  await assert.rejects(call('restore_file', { path: '.', backup_id: backup, expected_hash: current.sha256 }), /does not match/);
});
test('ambiguous edits fail without partial changes', async () => {
  const current = await call('write_file', { path: 'duplicate.txt', content: 'same\nsame\n' });
  await assert.rejects(call('edit_file', { path: 'duplicate.txt', expected_hash: current.sha256, edits: [{ old_text: 'same', new_text: 'different' }] }), /more than once/);
  assert.equal(await fs.readFile(path.join(root, 'duplicate.txt'), 'utf8'), 'same\nsame\n');
});
test('CRLF edits preserve Windows newlines', async () => {
  const current = await call('write_file', { path: 'windows.txt', content: 'a\r\nb\r\n' });
  await call('edit_file', { path: 'windows.txt', expected_hash: current.sha256, edits: [{ old_text: 'a\nb', new_text: 'a\nc' }] });
  assert.equal(await fs.readFile(path.join(root, 'windows.txt'), 'utf8'), 'a\r\nc\r\n');
});
test('paged read keeps hash and cursor', async () => {
  await fs.writeFile(path.join(root, 'long.txt'), Array.from({ length: 240 }, (_, i) => `row ${i + 1} ${'x'.repeat(60)}`).join('\n'));
  const first = await call('read_file', { path: 'long.txt', line_count: 200 });
  assert.ok(first.next_line > 1 && first.next_line < 200); assert.ok(JSON.stringify(first).length < 7000);
  const second = await call('read_file', { path: 'long.txt', start_line: first.next_line }); assert.equal(first.sha256, second.sha256);
});
test('directory pagination and nested filename search', async () => {
  await call('create_directory', { path: 'nested/deeper' });
  await call('write_file', { path: 'nested/deeper/needle.md', content: 'found' });
  const listing = await call('list_directory', { path: '.', limit: 2 }); assert.equal(listing.entries.length, 2); assert.equal(listing.next_offset, 2);
  const found = await call('search_files', { path: '.', query: 'needle' }); assert.equal(found.matches.length, 1);
});
test('read-only folder rejects writes', async () => {
  await assert.rejects(call('write_file', { path: 'readonly.txt', content: 'bad' }, { folderAccess: [{ folder_id: folder.id, mode: 'read' }] }), /read-only/);
});
test('unassigned folder rejects reads', async () => { await assert.rejects(call('read_file', { path: 'note.txt' }, { folderAccess: [] }), /not assigned/); });
test('relative escape rejects writes', async () => { await assert.rejects(call('write_file', { path: '../escape.txt', content: 'bad' }), /outside/); });
test('Windows alternate data streams rejected', async () => { await assert.rejects(call('write_file', { path: 'note.txt:hidden', content: 'bad' }), /alternate data stream/); });
test('junction paths rejected', async () => {
  await fs.symlink(root, path.join(root, 'linked'), 'junction');
  await assert.rejects(call('read_file', { path: 'linked/note.txt' }), /Linked paths/);
});
test('binary and invalid UTF-8 rejected', async () => {
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([1, 0, 3]));
  await assert.rejects(call('read_file', { path: 'binary.bin' }), /binary/);
  await fs.writeFile(path.join(root, 'invalid.bin'), Buffer.from([0xff, 0xfe]));
  await assert.rejects(call('read_file', { path: 'invalid.bin' }));
});
test('oversize regular file rejected', async () => {
  await fs.writeFile(path.join(root, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  await assert.rejects(call('read_file', { path: 'large.txt' }), /2 MB/);
});
test('concurrent stale writes permit exactly one replacement', async () => {
  const first = await call('write_file', { path: 'race.txt', content: 'before' });
  const outcomes = await Promise.allSettled(['a', 'b'].map(content => call('write_file', { path: 'race.txt', content, expected_hash: first.sha256 })));
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
});
test('invalid arguments rejected', async () => { await assert.rejects(call('read_file', { path: 'note.txt', start_line: -1 }), /Invalid/); });
test('Bash executes real command and reports exit/output', async () => {
  const result = await call('run_command', { path: '.', command: 'node -e "console.log(6 * 7)"' }); assert.equal(result.exit_code, 0); assert.match(result.output, /42/);
});
test('Bash nonzero exit marked as tool error', async () => {
  const result = await tools.call('files__run_command', { folder_id: folder.id, path: '.', command: 'exit 7' }, options); assert.equal(result.isError, true); assert.equal(JSON.parse(result.content[0].text).exit_code, 7);
});
test('Bash timeouts stop foreground process tree', async () => {
  const result = await call('run_command', { path: '.', command: 'node -e "setTimeout(()=>{},10000)"', timeout_seconds: 1 }); assert.equal(result.timed_out, true); assert.ok(result.elapsed_ms < 5000); assert.match(result.instruction, /stopped on timeout/);
});
test('read-only folder rejects Bash execution', async () => {
  await assert.rejects(call('run_command', { path: '.', command: 'echo nope' }, { folderAccess: [{ folder_id: folder.id, mode: 'read' }] }), /read-only/);
});

test('managed commands retain status, logs and stop across tool instances', async () => {
  const started = await call('run_command', { path: '.', mode: 'start', command: 'node -e "console.log(42);setInterval(()=>{},1000)"' });
  try {
    assert.equal(started.running, true); assert.ok(started.process_id);
    const fresh = new FilesystemTools();
    const checked = JSON.parse((await fresh.call('files__run_command', { folder_id: folder.id, mode: 'status', process_id: started.process_id }, options)).content[0].text);
    assert.equal(checked.running, true); assert.match(checked.output, /42/);
    await assert.rejects(call('run_command', { path: '.', mode: 'stop', process_id: started.process_id }, { ...options, agentId: 'different-agent' }), /another agent/);
    const listed = await call('run_command', { path: '.', mode: 'status' });
    assert.ok(listed.processes.some(item => item.process_id === started.process_id));
  } finally {
    const stopped = await call('run_command', { path: '.', mode: 'stop', process_id: started.process_id });
    assert.equal(stopped.stopped, true); assert.equal(stopped.running, false);
  }
});

test('managed early exit reports failure with actual logs', async () => {
  const result = await tools.call('files__run_command', { folder_id: folder.id, path: '.', mode: 'start', command: 'node -e "console.error(123);process.exit(7)"' }, options);
  assert.equal(result.isError, true); assert.match(JSON.parse(result.content[0].text).output, /123/);
});
test('plain Bonfire catalog excludes filesystem and command tools', async () => {
  const app = new AppTools({ mcp: { catalog: async () => [] } });
  assert.ok(!(await new GuyTools(app, null, []).catalog()).some(tool => tool.function.name.startsWith('files__')));
});
test('read-only guy catalog omits mutation schemas and scopes folder IDs', async () => {
  const app = new AppTools({ mcp: { catalog: async () => [] } });
  const catalog = await new GuyTools(app, { allowed_tools: tools.catalog().map(tool => tool.function.name), folder_access: [{ folder_id: folder.id, mode: 'read' }] }, []).catalog();
  assert.ok(!catalog.some(tool => tool.function.name === 'files__run_command' || tool.function.name === 'files__write_file'));
  assert.deepEqual(catalog.find(tool => tool.function.name === 'files__read_file').function.parameters.properties.folder_id.enum, [folder.id]);
});
