import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BACKEND_DIR } from './config.js';

export class FileFolders {
  constructor() { this.file = path.join(BACKEND_DIR, 'data/file-folders.json'); this.queue = Promise.resolve(); }
  async list() {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return []; }
  }
  mutate(action) {
    const result = this.queue.then(async () => {
      const rows = await this.list(), value = await action(rows);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file + '.tmp', JSON.stringify(rows, null, 2)); await fs.rename(this.file + '.tmp', this.file);
      return value;
    }); this.queue = result.catch(() => {}); return result;
  }
  async add(input) {
    const name = String(input?.name || '').trim(), supplied = String(input?.path || '');
    if (!name || name.length > 80 || !path.isAbsolute(supplied)) throw Error('Enter a folder name and full absolute path');
    const canonical = await fs.realpath(supplied);
    if (!(await fs.stat(canonical)).isDirectory()) throw Error('Choose an existing folder');
    return this.mutate(rows => {
      if (rows.some(row => row.path.toLowerCase() === canonical.toLowerCase())) throw Error('This folder is already configured');
      const row = { id: randomUUID(), name, path: canonical }; rows.push(row); return row;
    });
  }
  async remove(id) { return this.mutate(rows => { const index = rows.findIndex(row => row.id === id); if (index < 0) throw Error('Folder not found'); rows.splice(index, 1); }); }
}
export const fileFolders = new FileFolders();
