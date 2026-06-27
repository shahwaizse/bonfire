import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { DATABASE_PATH } from "./config.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  preset_id TEXT,
  sources TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  keywords TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

function nowIso() {
  return new Date().toISOString();
}

function rowToObject(row) {
  return row ? { ...row } : null;
}

export class BonfireDatabase {
  constructor(dbPath = DATABASE_PATH) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  init() {
    this.db.exec(SCHEMA);
    this.migrate();
  }

  close() {
    this.db.close();
  }

  migrate() {
    this.ensureColumn("messages", "preset_id", "ALTER TABLE messages ADD COLUMN preset_id TEXT");
    this.ensureColumn("messages", "sources", "ALTER TABLE messages ADD COLUMN sources TEXT");
    this.ensureColumn("conversations", "folder", "ALTER TABLE conversations ADD COLUMN folder TEXT NOT NULL DEFAULT ''");
  }

  tableColumns(tableName) {
    return this.db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
  }

  ensureColumn(tableName, columnName, statement) {
    if (!this.tableColumns(tableName).includes(columnName)) {
      this.db.exec(statement);
    }
  }

  createConversation(title) {
    const id = randomUUID();
    const now = nowIso();
    this.db
      .prepare("INSERT INTO conversations (id, title, folder, created_at, updated_at) VALUES (?, ?, '', ?, ?)")
      .run(id, title, now, now);
    return id;
  }

  touchConversation(id) {
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(nowIso(), id);
  }

  listConversations() {
    return this.db
      .prepare("SELECT id, title, folder, created_at, updated_at FROM conversations ORDER BY updated_at DESC")
      .all();
  }

  getConversation(id) {
    return rowToObject(
      this.db.prepare("SELECT id, title, folder, created_at, updated_at FROM conversations WHERE id = ?").get(id)
    );
  }

  updateConversation(id, fields) {
    const allowed = ["title", "folder"];
    const entries = Object.entries(fields).filter(([key, value]) => allowed.includes(key) && value != null);
    if (!entries.length) return this.getConversation(id);

    const updates = entries.map(([key]) => `${key} = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    this.db.prepare(`UPDATE conversations SET ${updates}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), id);
    return this.getConversation(id);
  }

  deleteConversation(id) {
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  clearConversations() {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM conversations").get().count;
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM messages").run();
      this.db.prepare("DELETE FROM conversations").run();
    });
    tx();
    return count;
  }

  addMessage({ conversationId, role, content, presetId = null, sources = null }) {
    const result = this.db
      .prepare(
        "INSERT INTO messages (conversation_id, role, content, preset_id, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(conversationId, role, content, presetId, sources, nowIso());
    return Number(result.lastInsertRowid);
  }

  getConversationMessages(conversationId) {
    return this.db
      .prepare(
        "SELECT id, role, content, preset_id, sources, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC"
      )
      .all(conversationId);
  }

  getSettings(keys) {
    if (!keys.length) return {};
    const placeholders = keys.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).all(...keys);
    const found = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return Object.fromEntries(keys.map((key) => [key, found[key] ?? null]));
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? row.value : fallback;
  }

  setSetting(key, value) {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, String(value));
  }

  listPresets() {
    return this.db.prepare("SELECT * FROM presets ORDER BY sort_order ASC, created_at ASC").all();
  }

  getPreset(id) {
    return rowToObject(this.db.prepare("SELECT * FROM presets WHERE id = ?").get(id));
  }

  upsertPreset({ id, name, description, systemPrompt, keywords, isBuiltin = false, sortOrder = 100 }) {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO presets (id, name, description, system_prompt, keywords, is_builtin, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(id, name, description, systemPrompt, JSON.stringify(keywords), isBuiltin ? 1 : 0, sortOrder, now, now);
  }

  updatePreset(id, fields) {
    const allowed = ["name", "description", "system_prompt", "keywords", "is_builtin", "sort_order"];
    const entries = Object.entries(fields).filter(([key, value]) => allowed.includes(key) && value != null);
    if (!entries.length) return;

    const updates = entries.map(([key]) => `${key} = ?`).join(", ");
    const values = entries.map(([key, value]) => {
      if (key === "keywords" && Array.isArray(value)) return JSON.stringify(value);
      if (key === "is_builtin") return value ? 1 : 0;
      return value;
    });
    this.db.prepare(`UPDATE presets SET ${updates}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), id);
  }

  deletePreset(id) {
    this.db.prepare("DELETE FROM presets WHERE id = ? AND is_builtin = 0").run(id);
  }
}

export const database = new BonfireDatabase();
