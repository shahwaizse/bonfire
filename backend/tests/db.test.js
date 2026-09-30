import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const moduleDb = tempDbPath();
process.env.DATABASE_PATH = moduleDb.dbPath;
const { BonfireDatabase, database } = await import("../src/db.js");

test.after(() => {
  database.close();
  fs.rmSync(moduleDb.dir, { recursive: true, force: true });
});

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bonfire-db-"));
  return { dir, dbPath: path.join(dir, "app.db") };
}

test("conversation messages persist across database reopen", () => {
  const { dir, dbPath } = tempDbPath();

  try {
    const first = new BonfireDatabase(dbPath);
    first.init();
    const conversationId = first.createConversation("Test chat");
    first.addMessage({ conversationId, role: "user", content: "hello" });
    first.addMessage({
      conversationId,
      role: "assistant",
      content: "hi",
      sources: JSON.stringify([{ title: "Source", url: "https://example.com", snippet: "" }]),
      toolActivity: JSON.stringify([{ type: 'tool_call', data: { name: 'workspace__read_file', arguments: { path: 'welcome.txt' } } }]),
      images: JSON.stringify([{ url: 'https://images.example.com/photo.jpg', source_url: 'https://example.com/source' }]),
    });
    first.close();

    const second = new BonfireDatabase(dbPath);
    second.init();
    assert.equal(second.listConversations().length, 1);
    assert.equal(second.getConversationMessages(conversationId).length, 2);
    assert.equal(JSON.parse(second.getConversationMessages(conversationId)[1].tool_activity)[0].data.name, 'workspace__read_file');
    assert.equal(JSON.parse(second.getConversationMessages(conversationId)[1].images)[0].url, 'https://images.example.com/photo.jpg');
    second.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("clearConversations removes conversations and messages", () => {
  const { dir, dbPath } = tempDbPath();
  const db = new BonfireDatabase(dbPath);

  try {
    db.init();
    const conversationId = db.createConversation("Clear me");
    db.addMessage({ conversationId, role: "user", content: "hello" });

    assert.equal(db.clearConversations(), 1);
    assert.equal(db.listConversations().length, 0);
    assert.equal(db.getConversationMessages(conversationId).length, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
