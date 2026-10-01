import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

export async function bashExecutable() {
  if (process.env.BONFIRE_BASH_PATH) return process.env.BONFIRE_BASH_PATH;
  if (process.platform !== 'win32') return '/bin/bash';
  for (const candidate of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) {
    try { await fs.access(candidate); return candidate; } catch { /* Try the next installation. */ }
  }
  throw Error('Git Bash was not found. Set BONFIRE_BASH_PATH to its executable and restart Bonfire.');
}

export function commandEnvironment() {
  const allowed = new Set(['path', 'pathext', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'home', 'userprofile', 'appdata', 'localappdata', 'programfiles', 'programfiles(x86)', 'programdata', 'lang', 'lc_all']);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
}

export async function runBash(command, cwd, { timeoutSeconds = 30, signal } = {}) {
  signal?.throwIfAborted();
  const executable = await bashExecutable();
  // Inherit OS essentials, not the backend's hosted-search keys or connector credentials.
  const env = commandEnvironment();
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--noprofile', '--norc', '-c', command], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', truncated = false, timedOut = false, settled = false;
    const collect = chunk => { const text = chunk.toString('utf8'); const available = Math.max(0, 4000 - output.length); output += text.slice(0, available); if (text.length > available) truncated = true; };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const terminator = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        terminator.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    };
    const abort = () => kill();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutSeconds * 1000);
    // A detached child can inherit pipes; bound the caller even if those pipes stay open.
    const deadline = setTimeout(() => finish({ exit_code: null, timed_out: true, output, truncated, elapsed_ms: performance.now() - started }), (timeoutSeconds + 3) * 1000);
    function finish(result, error) {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(deadline); signal?.removeEventListener('abort', abort);
      child.stdout.destroy(); child.stderr.destroy();
      if (signal?.aborted) reject(signal.reason || Error('Command cancelled'));
      else if (error) reject(error);
      else resolve(result);
    }
    child.on('error', error => finish(null, error));
    child.on('close', code => finish({ exit_code: code, timed_out: timedOut, output, truncated, elapsed_ms: performance.now() - started }));
    if (signal?.aborted) abort();
  });
}
