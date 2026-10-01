import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../../scripts/read-machine.ps1', import.meta.url));
let cached, probe, retryAt = 0;
const waiters = new Set();
export function startMachineSampler() {
  if (process.platform !== 'win32' || probe || Date.now() < retryAt) return;
  const executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Watch'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  probe = child; let buffer = '';
  child.stderr.on('data', () => {});
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 512 * 1024) { buffer = ''; child.kill(); return; }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim().replace(/^\uFEFF/, ''); buffer = buffer.slice(index + 1);
      if (!line) continue;
      try { const value = JSON.parse(line); if (!value.captured_at) continue; cached = { value, time: Date.now() }; for (const resolve of [...waiters]) resolve(); }
      catch { /* Never invent sensor values from malformed diagnostics. */ }
    }
  });
  const closed = () => { if (probe === child) { probe = null; retryAt = Date.now() + 30000; for (const resolve of [...waiters]) resolve(); } };
  child.on('error', closed); child.on('exit', closed);
}
export async function machineSnapshot({ signal } = {}) {
  signal?.throwIfAborted();
  if (process.platform !== 'win32') return { captured_at: new Date().toISOString(), unavailable: true, notes: ['This hardware probe currently supports Windows.'] };
  startMachineSampler();
  if (!cached || Date.now() - cached.time > 15000) {
    await new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const cancelled = () => { cleanup(); reject(signal.reason || new DOMException('Cancelled', 'AbortError')); };
      const timer = setTimeout(done, 12000);
      const cleanup = () => { clearTimeout(timer); waiters.delete(done); signal?.removeEventListener('abort', cancelled); };
      waiters.add(done); signal?.addEventListener('abort', cancelled, { once: true });
      if (signal?.aborted) cancelled();
    });
  }
  signal?.throwIfAborted();
  if (!cached || Date.now() - cached.time > 15000) throw new Error('Hardware probe unavailable or stale');
  return { ...cached.value, sample_age_seconds: Math.round((Date.now() - cached.time) / 1000), sampling_interval_seconds: 5 };
}
export function stopMachineSampler() { if (probe) { probe.kill(); probe = null; } }
process.once('exit', stopMachineSampler);
