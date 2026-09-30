import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// Separate from chat history: clearing chats must never replenish search credits.
export class SearchUsage {
  constructor(filename) {
    if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS search_usage (
      provider TEXT NOT NULL, month TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
      exhausted INTEGER NOT NULL DEFAULT 0, blocked_until INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider, month)
    )`);
  }

  reserve(provider, date, limit) {
    const month = date.toISOString().slice(0, 7);
    return this.db.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO search_usage (provider, month) VALUES (?, ?)").run(provider, month);
      const result = this.db.prepare(`UPDATE search_usage SET used = used + 1
        WHERE provider = ? AND month = ? AND used < ? AND exhausted = 0 AND blocked_until <= ?`)
        .run(provider, month, Math.min(1000, Math.max(0, Math.floor(limit))), date.getTime());
      return result.changes === 1;
    }).immediate();
  }

  block(provider, date, exhausted, cooldownMs = 0) {
    this.db.prepare(`UPDATE search_usage SET exhausted = ?, blocked_until = ? WHERE provider = ? AND month = ?`)
      .run(exhausted ? 1 : 0, date.getTime() + cooldownMs, provider, date.toISOString().slice(0, 7));
  }

  close() { this.db.close(); }
}
