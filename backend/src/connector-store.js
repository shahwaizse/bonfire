import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BACKEND_DIR } from './config.js';

// DPAPI binds the encrypted connector store to the current Windows account.
// Secrets enter PowerShell through stdin, never command arguments or logs.
async function crypt(value, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('Connector credential storage currently requires Windows');
  const command = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $raw=[Console]::In.ReadToEnd(); $bytes=[Convert]::FromBase64String($raw); $result=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('Credential encryption unavailable')); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error('Could not read or encrypt connector credentials for this Windows account')); });
    child.stdin.on('error', () => {}); child.stdin.end(value);
  });
}

export class ConnectorStore {
  constructor(file = process.env.BONFIRE_CONNECTOR_STORE || path.join(BACKEND_DIR, 'data/connectors.dpapi')) { this.file = file; this.tail = Promise.resolve(); }
  async load() {
    if (this.rows) return this.rows;
    this.loading ||= (async () => {
      try { const encrypted = await fs.readFile(this.file, 'utf8'); this.rows = JSON.parse(Buffer.from(await crypt(encrypted, true), 'base64').toString('utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; this.rows = []; }
      return this.rows;
    })();
    return this.loading;
  }
  async save() {
    // Snapshot at invocation so queued writes never silently lose a token rotation.
    const snapshot = JSON.stringify(await this.load());
    const write = async () => {
      const encrypted = await crypt(Buffer.from(snapshot).toString('base64'));
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = this.file + '.tmp'; await fs.writeFile(temporary, encrypted, { mode: 0o600 }); await fs.rename(temporary, this.file);
    };
    const pending = this.tail.then(write); this.tail = pending.catch(() => {}); return pending;
  }
}
