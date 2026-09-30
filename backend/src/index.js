import express from "express";
import cors from "cors";
import { HOST, PORT, CORS_ORIGINS } from "./config.js";
import { database } from "./db.js";
import { buildChatMessages } from "./prompting.js";
import { healthCheck } from "./llama.js";
import { mcpRegistry } from './mcp.js';
import { runToolLoop } from './tool-loop.js';
import { search } from "./search.js";
import { AppTools } from './app-tools.js';
import { resolveSearchContext } from './search-context.js';
import { isPictureRequest } from './image-search.js';

database.init();

const app = express();
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (_req, res) => {
  res.json({ status: "ok", llama_cpp: await healthCheck(), model: 'Qwen3.5-9B', mcp: mcpRegistry.status });
});

app.get('/tools', async (_req, res) => {
  try { res.json({ tools: await mcpRegistry.catalog(), servers: mcpRegistry.status }); }
  catch { res.status(503).json({ detail: 'Invalid MCP configuration' }); }
});

app.get("/conversations", (_req, res) => {
  res.json(database.listConversations());
});

app.delete("/conversations", (_req, res) => {
  res.json({ ok: true, conversations_deleted: database.clearConversations() });
});

app.get("/conversations/:id", (req, res) => {
  const conversation = database.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ detail: "Conversation not found" });

  const messages = database.getConversationMessages(req.params.id).map((message) => ({
    ...message,
    sources: parseJson(message.sources, null),
    tool_activity: parseJson(message.tool_activity, null),
    images: parseJson(message.images, null),
  }));
  res.json({ ...conversation, messages });
});

app.patch("/conversations/:id", (req, res) => {
  const conversation = database.updateConversation(req.params.id, {
    title: typeof req.body?.title === "string" ? req.body.title : "",
  });
  if (!conversation) return res.status(404).json({ detail: "Conversation not found" });
  res.json(conversation);
});

app.delete("/conversations/:id", (req, res) => {
  database.deleteConversation(req.params.id);
  res.json({ ok: true });
});

app.post("/search", async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();
    if (!query) return res.status(400).json({ detail: "Query is required" });
    res.json({ query, results: await search(query) });
  } catch (error) {
    res.status(502).json({ detail: `Search failed: ${error.message}` });
  }
});

app.post("/chat", async (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ detail: "Message is required" });

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.flushHeaders?.();

  const abortController = new AbortController();
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      clientGone = true;
      abortController.abort();
    }
  });

  const send = (type, data) => {
    if (!clientGone && !res.destroyed && !res.writableEnded) res.write(`${JSON.stringify({ type, data })}\n`);
  };

  let conversationId = req.body?.conversation_id || null;
  let assistantText = "";
  const tools = new AppTools({ webEnabled: Boolean(req.body?.search_enabled), emit: send });
  const sources = tools.sources;
  const images = tools.images;
  const toolActivity = [];

  try {
    if (!conversationId) {
      const title = titleFromMessage(message);
      conversationId = database.createConversation(title);
      send("conversation", { conversation_id: conversationId, title });
    }

    database.addMessage({ conversationId, role: "user", content: message });
    const history = database.getConversationMessages(conversationId);

    // Web is an explicit search override until automatic tool selection is reliable.
    // Picture intent only skips this prefetch; the model still calls search_images itself.
    let webContext = '';
    if (req.body?.search_enabled && !isPictureRequest(message, history)) {
      const context = await resolveSearchContext({ message, history, webEnabled: true, signal: abortController.signal, emit: send });
      for (const source of context.sources) tools.addSource(source);
      tools.searchCalls++;
      webContext = context.webContext;
    }
    abortController.signal.throwIfAborted();
    const llmMessages = buildChatMessages({ history, webContext, webEnabled: Boolean(req.body?.search_enabled) });
    send("status", "Generating answer...");

    await runToolLoop(llmMessages, {
      registry: tools,
      signal: abortController.signal,
      emit: (type, data) => {
        if (type === 'token') assistantText += data;
        if (type === 'tool_call' || type === 'tool_result') toolActivity.push({ type, data });
        send(type, data);
      },
    });
  } catch (error) {
    if (error.name !== "AbortError") {
      const detail = `Request failed: ${error.message}`;
      assistantText += `\n\n_Error: ${detail}_`;
      send('error', detail);
    }
  } finally {
    if (conversationId && (assistantText.trim() || images.length || toolActivity.length)) {
      database.addMessage({
        conversationId,
        role: "assistant",
        content: assistantText,
        sources: sources.length ? JSON.stringify(sources) : null,
        toolActivity: toolActivity.length ? JSON.stringify(toolActivity) : null,
        images: images.length ? JSON.stringify(images) : null,
      });
      database.touchConversation(conversationId);
    }
    send("done", { conversation_id: conversationId });
    if (!clientGone && !res.destroyed && !res.writableEnded) res.end();
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Bonfire backend listening on http://${HOST}:${PORT}`);
});
mcpRegistry.catalog().catch(() => console.error('Invalid MCP configuration; check backend/mcp.json'));

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  void mcpRegistry.close();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function titleFromMessage(message) {
  const words = message
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (!words.length) return "New chat";

  const title = words.join(" ");
  return title.length > 60 ? `${title.slice(0, 57).trim()}...` : title;
}
