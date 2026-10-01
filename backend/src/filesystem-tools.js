import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import { writeFileContent } from '@modelcontextprotocol/server-filesystem/dist/lib.js';
import { fileFolders } from './file-folders.js';
import { runBash } from './command-runner.js';
import { managedCommand } from './managed-commands.js';

const maxBytes = 2 * 1024 * 1024;
const backupRoot = path.resolve(process.env.BONFIRE_FILES_BACKUP_DIR || (process.platform === 'win32' ? 'D:/Projects/bonfire-file-backups' : './data/file-backups'));
const readonly = new Set(['files__list_folders', 'files__list_directory', 'files__read_file', 'files__search_files']);
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const hash = value => createHash('sha256').update(value).digest('hex');
const folderPath = { folder_id: { type: 'string', description: 'Assigned folder ID from list_folders.' }, path: { type: 'string', maxLength: 2048, description: 'Path relative to that folder. Use . for the root.' } };
const expectedHash = { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Full-file SHA256 from a recent read. Required when modifying an existing file.' };
function schema(name, description, properties, required) { return { type: 'function', function: { name: `files__${name}`, description, parameters: { type: 'object', properties, required, additionalProperties: false } } }; }
export const filesystemSchemas = [
  schema('list_folders', 'List the folders assigned to this guy and their read/write access. Start here to discover folder IDs.', {}, []),
  schema('list_directory', 'List one directory, with pagination. Paths stay inside the chosen assigned folder.', { ...folderPath, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['folder_id', 'path']),
  schema('read_file', 'Read raw UTF-8 text pages and full-file SHA256. Line ranges are metadata, not part of the content. Use start_line to page through long files; reads are bounded.', { ...folderPath, start_line: { type: 'integer', minimum: 1 }, line_count: { type: 'integer', minimum: 1, maximum: 200 } }, ['folder_id', 'path']),
  schema('search_files', 'Find filenames by substring recursively; .git, node_modules and vendor are skipped. Returns up to 100 paths with a scan limit.', { ...folderPath, query: { type: 'string', minLength: 1, maxLength: 200 } }, ['folder_id', 'path', 'query']),
  schema('write_file', 'Create or replace a UTF-8 file. Existing files require expected_hash from read_file; new files omit it. Backups and atomic writes are automatic. Create parent folders first.', { ...folderPath, content: { type: 'string', maxLength: 64000 }, expected_hash: expectedHash }, ['folder_id', 'path', 'content']),
  schema('edit_file', 'Replace exact unique text in a UTF-8 file. old_text/new_text CAN span multiple lines: include unchanged surrounding text in BOTH to distinguish repeated values. Read first, supply expected_hash. Returns hashes and backup ID.', { ...folderPath, expected_hash: expectedHash, edits: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: { old_text: { type: 'string', minLength: 1, maxLength: 16000, description: 'Exact substring to find, including multiline context when needed. No displayed line-number prefixes.' }, new_text: { type: 'string', maxLength: 16000, description: 'Replacement for the whole old_text block, preserving any unchanged context.' } }, required: ['old_text', 'new_text'], additionalProperties: false } } }, ['folder_id', 'path', 'expected_hash', 'edits']),
  schema('create_directory', 'Create a directory and missing parents inside a writable assigned folder.', folderPath, ['folder_id', 'path']),
  schema('restore_file', 'Restore a previous file version using its backup ID. Requires write access and current file hash. Optional path must match the backup. Does not delete newly created files.', { ...folderPath, backup_id: { type: 'string', format: 'uuid' }, expected_hash: expectedHash }, ['folder_id', 'backup_id', 'expected_hash']),
  schema('run_command', 'Execute Bash (mode=run, default), or manage a persistent app: mode=start runs a foreground command in the background and returns process_id; mode=status lists managed processes or checks one with logs; mode=stop stops its process tree. NOT sandboxed. Paths resolve relative to the supplied working directory.', { ...folderPath, path: { ...folderPath.path, description: 'Optional existing working directory relative to assigned root, default . Commands resolve filenames relative to THIS directory.' }, command: { type: 'string', minLength: 1, maxLength: 8000 }, mode: { type: 'string', enum: ['run', 'start', 'status', 'stop'] }, process_id: { type: 'string', pattern: '^[a-f0-9-]{36}$', description: 'Returned by a managed start/status. Never an OS PID.' }, timeout_seconds: { type: 'integer', minimum: 1, maximum: 60 } }, ['folder_id']),
];
const ajv = new Ajv({ strict: false, validateFormats: false });
const validators = new Map(filesystemSchemas.map(tool => [tool.function.name, ajv.compile(tool.function.parameters)]));
const within = (root, candidate) => { const relative = path.relative(root, candidate); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

export class FilesystemTools {
  constructor() { this.queue = Promise.resolve(); }
  catalog() { return filesystemSchemas; }
  isReadOnly(name) { return readonly.has(name); }
  async resolve(folder, supplied, allowMissing = false) {
    if (typeof supplied !== 'string' || supplied.includes('\0')) throw Error('Invalid file path');
    const root = await fs.realpath(folder.path);
    if (path.resolve(root).toLowerCase() !== path.resolve(folder.path).toLowerCase()) throw Error('Configured folder moved or became a link; configure it again');
    const target = path.resolve(root, supplied), relative = path.relative(root, target);
    if (!within(root, target) || relative.includes(':')) throw Error('Path is outside the assigned folder or uses an alternate data stream');
    let current = root;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw Error('Linked paths are not supported; assign the target folder directly'); }
      catch (error) { if (allowMissing && error.code === 'ENOENT') continue; throw error; }
    }
    return { root, target, relative: relative || '.' };
  }
  async read(target) {
    const handle = await fs.open(target, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) throw Error('Text operations support regular files up to 2 MB');
      const buffer = Buffer.alloc(maxBytes + 1); let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (!chunk.bytesRead) break;
        bytesRead += chunk.bytesRead;
      }
      if (bytesRead > maxBytes) throw Error('File exceeds the 2 MB limit');
      const after = await handle.stat();
      if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || bytesRead !== after.size) throw Error('File changed while reading. Read it again.');
      const bytes = buffer.subarray(0, bytesRead);
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (content.includes('\0')) throw Error('This is a binary file, not UTF-8 text');
      return { content, sha256: hash(bytes), size: bytesRead };
    } finally { await handle.close(); }
  }
  async save(folder, resolved, content, expected, agentId, signal) {
    let before;
    try { before = await this.read(resolved.target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (before ? expected !== before.sha256 : Boolean(expected)) throw Error('File changed or expected_hash is missing. Read it again before writing.');
    if (Buffer.byteLength(content) > maxBytes) throw Error('Result exceeds the 2 MB limit');
    if (before?.content === content) return { path: resolved.relative, changed: false, sha256: before.sha256 };
    const backupId = randomUUID();
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.writeFile(path.join(backupRoot, `${backupId}.json`), JSON.stringify({ id: backupId, folder_id: folder.id, path: resolved.relative, agent_id: agentId, created_at: new Date().toISOString(), before: before?.content ?? null, before_hash: before?.sha256 ?? null }), { flag: 'wx', mode: 0o600 });
    signal?.throwIfAborted();
    // Recheck location and version immediately before the upstream atomic-write primitive.
    await this.resolve(folder, resolved.relative, true);
    let current;
    try { current = await this.read(resolved.target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if ((current?.sha256 || null) !== (before?.sha256 || null)) throw Error('File changed while preparing the write. Read it again.');
    let after;
    try {
      await writeFileContent(resolved.target, content);
      after = await this.read(resolved.target);
      if (after.sha256 !== hash(Buffer.from(content))) throw Error('File contents do not match the requested write');
    } catch (error) { throw Error(`Write was not verified: ${error.message}. Backup ID: ${backupId}. Read the file before retrying.`); }
    return { path: resolved.relative, changed: true, created: !before, bytes: after.size, before_sha256: before?.sha256 ?? null, sha256: after.sha256, backup_id: backupId };
  }
  async call(name, args, { folderAccess = [], agentId, signal } = {}) {
    const validate = validators.get(name);
    if (!validate?.(args)) throw Error(`Invalid filesystem tool arguments: ${validate ? ajv.errorsText(validate.errors) : 'unknown tool'}`);
    const perform = async () => {
      signal?.throwIfAborted();
      const folders = await fileFolders.list();
      const assigned = folders.filter(folder => folderAccess.some(access => access.folder_id === folder.id));
      if (name === 'files__list_folders') return text({ folders: assigned.map(folder => ({ ...folder, access: folderAccess.find(access => access.folder_id === folder.id).mode })) });
      const folder = assigned.find(item => item.id === args.folder_id);
      if (!folder) throw Error('This folder is not assigned to this little guy');
      if (!readonly.has(name) && !folderAccess.some(access => access.folder_id === folder.id && access.mode === 'write')) throw Error('This folder is assigned read-only');
      if (name === 'files__restore_file') {
        if (!/^[a-f0-9-]{36}$/i.test(args.backup_id)) throw Error('Invalid backup ID');
        const backup = JSON.parse(await fs.readFile(path.join(backupRoot, `${args.backup_id}.json`), 'utf8'));
        if (backup.folder_id !== folder.id || backup.before === null) throw Error('Backup belongs to another folder or the file was newly created');
        const resolved = await this.resolve(folder, backup.path);
        if (args.path && (await this.resolve(folder, args.path)).target !== resolved.target) throw Error('Restore path does not match the backup file');
        return text(await this.save(folder, resolved, backup.before, args.expected_hash, agentId, signal));
      }
      const resolved = await this.resolve(folder, name === 'files__run_command' ? args.path ?? '.' : args.path, ['files__write_file', 'files__create_directory'].includes(name));
      if (name === 'files__run_command') {
        if (!(await fs.stat(resolved.target)).isDirectory()) throw Error('Command working directory must be a folder');
        if (args.mode && args.mode !== 'run') {
          const result = await managedCommand(args, resolved.target, { agentId, signal });
          return { ...text(result), isError: args.mode === 'start' ? !result.running : args.mode === 'stop' ? !result.stopped : false };
        }
        if (!args.command?.trim()) throw Error('mode=run requires command');
        const result = await runBash(args.command, resolved.target, { timeoutSeconds: args.timeout_seconds || 30, signal });
        const instruction = result.timed_out ? 'The foreground process tree was stopped on timeout. Start persistent apps with mode=start and a foreground command (no nohup or &), then verify their URL.' : result.exit_code === 127 ? 'Command was not found. Choose an installed command; repeating it cannot fix this. On Windows/Git Bash, native process inspection uses PowerShell Get-CimInstance/Get-NetTCPConnection, not lsof.' : result.exit_code !== 0 && !result.output.trim() ? 'Empty output with a nonzero exit is not evidence that an app stopped. Inspect its PID file, logs or native OS process/port information, then verify its URL.' : undefined;
        return { ...text({ ...result, cwd: resolved.target, ...(instruction ? { instruction } : {}) }), isError: result.timed_out || result.exit_code !== 0 };
      }
      if (name === 'files__list_directory') {
        const entries = (await fs.readdir(resolved.target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
        const start = args.offset || 0, limit = args.limit || 50;
        const page = []; let size = 0;
        for (const entry of entries.slice(start, start + limit)) {
          const row = { name: entry.name, type: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file' };
          if (size + JSON.stringify(row).length > 4000) break;
          page.push(row); size += JSON.stringify(row).length;
        }
        return text({ path: resolved.relative, entries: page, total: entries.length, next_offset: start + page.length < entries.length ? start + page.length : null });
      }
      if (name === 'files__read_file') {
        const file = await this.read(resolved.target), lines = file.content.split(/\r\n|\n/), start = (args.start_line || 1) - 1;
        const selected = []; let length = 0, next = start;
        for (; next < Math.min(lines.length, start + (args.line_count || 80)); next++) {
          const line = lines[next];
          const encodedLength = JSON.stringify(line).length + 2;
          if (length + encodedLength > 4000) { if (!selected.length) throw Error('This line is too long for a text read'); break; }
          selected.push(line); length += encodedLength;
        }
        return text({ path: resolved.relative, sha256: file.sha256, bytes: file.size, total_lines: lines.length, start_line: start + 1, end_line: next, content: selected.join('\n'), next_line: next < lines.length ? next + 1 : null });
      }
      if (name === 'files__search_files') {
        const pending = [resolved.target], matches = []; let visited = 0, resultSize = 0, budgetHit = false;
        while (pending.length && visited < 3000 && matches.length < 100 && !budgetHit) {
          signal?.throwIfAborted(); const directory = pending.shift();
          for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            if (++visited > 3000 || matches.length >= 100) break;
            if (entry.isSymbolicLink() || ['.git', 'node_modules', 'vendor'].includes(entry.name)) continue;
            const target = path.join(directory, entry.name); await this.resolve(folder, path.relative(resolved.root, target));
            if (entry.name.toLowerCase().includes(args.query.toLowerCase())) {
              const match = { path: path.relative(resolved.root, target), type: entry.isDirectory() ? 'directory' : 'file' };
              const size = JSON.stringify(match).length;
              if (resultSize + size > 4000) { budgetHit = true; break; }
              matches.push(match); resultSize += size;
            }
            if (entry.isDirectory()) pending.push(target);
          }
        }
        return text({ matches, scanned_entries: visited, truncated: Boolean(budgetHit || pending.length || visited >= 3000 || matches.length >= 100) });
      }
      if (name === 'files__create_directory') { await fs.mkdir(resolved.target, { recursive: true }); await this.resolve(folder, args.path); return text({ path: resolved.relative, directory_exists: true }); }
      if (name === 'files__write_file') return text(await this.save(folder, resolved, args.content, args.expected_hash, agentId, signal));
      if (name === 'files__edit_file') {
        const before = await this.read(resolved.target);
        if (before.sha256 !== args.expected_hash) throw Error('File changed. Read it again before editing.');
        let content = before.content; const crlf = content.includes('\r\n');
        const newline = value => crlf ? value.replace(/\r?\n/g, '\r\n') : value;
        for (const edit of args.edits) {
          const oldText = newline(edit.old_text), index = content.indexOf(oldText);
          if (index < 0) throw Error('old_text was not found. Use exact raw file text without displayed line-number prefixes. old_text and new_text both support multiline strings using JSON newline escapes. No change was made.');
          if (content.indexOf(oldText, index + 1) >= 0) throw Error('old_text matches more than once. Include an unchanged surrounding line, such as a section header, in BOTH old_text and new_text to target one unique block. Both strings support multiple lines using JSON newline escapes. No change was made.');
          content = content.slice(0, index) + newline(edit.new_text) + content.slice(index + oldText.length);
        }
        return text(await this.save(folder, resolved, content, before.sha256, agentId, signal));
      }
      throw Error('Unknown filesystem tool');
    };
    // Shared queue prevents Bonfire's own concurrent writes from racing one another.
    const result = this.queue.then(perform); this.queue = result.catch(() => {}); return result;
  }
}
export const filesystemTools = new FilesystemTools();
