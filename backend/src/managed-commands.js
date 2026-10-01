import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { bashExecutable, commandEnvironment } from './command-runner.js';

const execute = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(process.env.BONFIRE_PROCESS_DIR || (process.platform === 'win32' ? 'D:/Projects/bonfire-processes' : './data/processes'));

// Persist OS creation identity as well as PID: a recycled PID must never target another app.
async function identity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw Error('Invalid process PID');
  if (process.platform === 'win32') {
    const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.CreationDate.ToUniversalTime().Ticks.ToString() }`;
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000 });
    return stdout.trim() || null;
  }
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[0] === 'Z' ? null : fields[19];
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function logs(record) {
  const handle = await fs.open(path.join(root, `${record.process_id}.log`), 'r');
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, 3000));
    await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return { output: buffer.toString('utf8'), truncated: size > buffer.length };
  } finally { await handle.close(); }
}

async function status(record) {
  const current = await identity(record.pid);
  return { ...record, running: Boolean(current && current === record.identity), identity_matches: Boolean(current && current === record.identity), ...(await logs(record)) };
}

export async function managedCommand(args, cwd, { agentId, signal } = {}) {
  signal?.throwIfAborted();
  await fs.mkdir(root, { recursive: true });
  const mode = args.mode;
  if (mode === 'start') {
    if (!args.command?.trim()) throw Error('start requires a foreground command, such as node server.cjs. Do not add nohup or &.');
    const processId = randomUUID();
    const log = await fs.open(path.join(root, `${processId}.log`), 'wx');
    let child, record;
    try {
      // Keep the parent alive for accidental background jobs as well as foreground apps.
      const script = `${args.command}\nbonfire_command_status=$?\nwait\nexit "$bonfire_command_status"`;
      child = spawn(await bashExecutable(), ['--noprofile', '--norc', '-c', script], { cwd, env: commandEnvironment(), detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      const created = await identity(child.pid);
      record = { process_id: processId, pid: child.pid, identity: created, command: args.command, cwd, folder_id: args.folder_id, agent_id: agentId || null, started_at: new Date().toISOString() };
      await fs.writeFile(path.join(root, `${processId}.json`), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    } catch (error) { child?.kill(); throw error; }
    finally { await log.close(); }
    await pause(250);
    return { ...(await status(record)), instruction: 'This is a managed process. Use mode=status/stop with process_id. Running does not prove HTTP readiness; verify the requested URL separately.' };
  }
  if (mode === 'status' && !args.process_id) {
    const records = [];
    for (const filename of await fs.readdir(root)) {
      if (!filename.endsWith('.json')) continue;
      const record = JSON.parse(await fs.readFile(path.join(root, filename), 'utf8'));
      if (record.folder_id === args.folder_id && record.agent_id === (agentId || null)) records.push(record);
    }
    // Only Bonfire-owned records; never infer ownership from a port or arbitrary PID file.
    records.sort((a, b) => b.started_at.localeCompare(a.started_at));
    const recent = await Promise.all(records.slice(0, 10).map(status));
    return { processes: recent.map(({ process_id, pid, command, cwd, running, started_at }) => ({ process_id, pid, command, cwd, running, started_at })), total: records.length, instruction: 'Only the ten most recent managed launches are listed. Inspect one process_id for logs. Older nohup launches are not tracked here.' };
  }
  if (!/^[a-f0-9-]{36}$/i.test(args.process_id || '')) throw Error('Provide process_id from a managed start or status result');
  const record = JSON.parse(await fs.readFile(path.join(root, `${args.process_id}.json`), 'utf8'));
  if (record.folder_id !== args.folder_id || record.agent_id !== (agentId || null)) throw Error('This managed process belongs to another agent or assigned folder');
  const before = await status(record);
  if (mode === 'status') return before;
  if (mode !== 'stop') throw Error('Unknown managed command mode');
  if (before.running) {
    signal?.throwIfAborted();
    if (process.platform === 'win32') {
      await execute('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 });
    } else process.kill(-record.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 10 && await identity(record.pid) === record.identity; attempt++) await pause(100);
  }
  const after = await status(record);
  return { ...after, stopped: !after.running, instruction: after.running ? 'Stop was not verified; process remains running.' : 'Managed process identity is no longer running. For a web app, verify its URL is unreachable as a separate check.' };
}
