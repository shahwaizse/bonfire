import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { DATABASE_PATH } from "./config.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sources TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
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
    this.ensureColumn("messages", "sources", "ALTER TABLE messages ADD COLUMN sources TEXT");
    this.ensureColumn('messages', 'tool_activity', 'ALTER TABLE messages ADD COLUMN tool_activity TEXT');
    this.ensureColumn('messages', 'images', 'ALTER TABLE messages ADD COLUMN images TEXT');
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, id)");
  }

  tableColumns(tableName) {
    return this.db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
  }

  hasColumn(tableName, columnName) {
    return this.tableColumns(tableName).includes(columnName);
  }

  ensureColumn(tableName, columnName, statement) {
    if (!this.hasColumn(tableName, columnName)) this.db.exec(statement);
  }

  createConversation(title) {
    const id = randomUUID();
    const now = nowIso();
    this.db
      .prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, title, now, now);
    return id;
  }

  touchConversation(id) {
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(nowIso(), id);
  }

  listConversations() {
    const sourceFilter = this.hasColumn("conversations", "source") ? "WHERE source = 'chat'" : "";
    return this.db
      .prepare(`SELECT id, title, created_at, updated_at FROM conversations ${sourceFilter} ORDER BY updated_at DESC`)
      .all();
  }

  getConversation(id) {
    return rowToObject(
      this.db.prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?").get(id)
    );
  }

  updateConversation(id, fields) {
    const title = typeof fields.title === "string" ? fields.title.trim() : "";
    if (title) {
      this.db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title, nowIso(), id);
    }
    return this.getConversation(id);
  }

  deleteConversation(id) {
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  clearConversations() {
    const sourceFilter = this.hasColumn("conversations", "source") ? "WHERE source = 'chat'" : "";
    const rows = this.db.prepare(`SELECT id FROM conversations ${sourceFilter}`).all();
    const tx = this.db.transaction((ids) => {
      for (const { id } of ids) this.deleteConversation(id);
    });
    tx(rows);
    return rows.length;
  }

  addMessage({ conversationId, role, content, sources = null, toolActivity = null, images = null }) {
    const result = this.db
      .prepare("INSERT INTO messages (conversation_id, role, content, sources, tool_activity, images, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(conversationId, role, content, sources, toolActivity, images, nowIso());
    return Number(result.lastInsertRowid);
  }

  getConversationMessages(conversationId) {
    return this.db
      .prepare("SELECT id, role, content, sources, tool_activity, images, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC")
      .all(conversationId);
  }
}

export const database = new BonfireDatabase();
