import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const defaultPath = fileURLToPath(new URL('../data/desktop-apps.json', import.meta.url));
export class DesktopApps {
  constructor(configPath = process.env.BONFIRE_APPS_PATH || defaultPath) { this.configPath = path.resolve(configPath); this.queue = Promise.resolve(); this.cached = null; }
  async list() {
    try {
      const stamp = await fs.stat(this.configPath);
      if (this.cached?.stamp === `${stamp.mtimeMs}:${stamp.size}`) return structuredClone(this.cached.apps);
      const data = JSON.parse(await fs.readFile(this.configPath, 'utf8'));
      if (!Array.isArray(data)) throw new Error('Invalid app configuration');
      this.cached = { stamp: `${stamp.mtimeMs}:${stamp.size}`, apps: data };
      return data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (process.platform !== 'win32') return [];
      return [{ id: 'notepad', name: 'Notepad', kind: 'executable', target: path.join(process.env.SystemRoot || 'C:/Windows', 'System32/notepad.exe') }];
    }
  }
  async validate(input) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 64) throw new Error('Give the app a name of up to 64 characters');
    if (!['executable', 'steam'].includes(input.kind) || typeof input.target !== 'string') throw new Error('Choose a Windows executable or Steam app ID');
    if (input.kind === 'steam') {
      if (!/^\d{1,10}$/.test(input.target)) throw new Error('Steam app IDs contain digits only');
    } else {
      if (process.platform !== 'win32') throw new Error('Executable launching requires Windows');
      if (!path.win32.isAbsolute(input.target) || input.target.startsWith('\\\\') || !/\.exe$/i.test(input.target) || input.target.length > 1000) throw new Error('Use a full local .exe path');
      if (!(await fs.stat(input.target)).isFile()) throw new Error('Executable not found');
    }
    return { name: input.name.trim(), kind: input.kind, target: input.target };
  }
  async save(input, id) {
    const app = await this.validate(input);
    return this.mutate(apps => {
      const saved = { ...app, id: id || randomUUID() };
      return { apps: [...apps.filter(item => item.id !== saved.id), saved], result: saved };
    });
  }
  async remove(id) { return this.mutate(apps => ({ apps: apps.filter(app => app.id !== id), result: { ok: true } })); }
  mutate(fn) {
    const operation = this.queue.then(async () => {
      const { apps, result } = fn(await this.list());
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      const temp = `${this.configPath}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(apps, null, 2));
      await fs.rename(temp, this.configPath);
      this.cached = null;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async launch(id, { signal } = {}) {
    if (process.platform !== 'win32') throw new Error('App launching requires Windows');
    const app = (await this.list()).find(item => item.id === id);
    if (!app) throw new Error('App is not configured');
    await this.validate(app);
    signal?.throwIfAborted();
    const executable = app.kind === 'steam' ? path.join(process.env.SystemRoot || 'C:/Windows', 'explorer.exe') : app.target;
    const args = app.kind === 'steam' ? [`steam://rungameid/${app.target}`] : [];
    // The configured application is intentionally visible and interactive. No shell or model-supplied arguments.
    const child = spawn(executable, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: false });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
    child.unref();
    return { app_id: id, name: app.name, status: 'launch_requested', note: 'The launch request was sent. This does not verify that the application window opened.' };
  }
}
export const desktopApps = new DesktopApps();
