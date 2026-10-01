import express from "express";
import cors from "cors";
import { HOST, PORT, CORS_ORIGINS, LLM_MODEL_NAME } from "./config.js";
import { database } from "./db.js";
import { buildChatMessages, selectTokenHistory } from "./prompting.js";
import { healthCheck, countTokens } from "./llama.js";
import { mcpRegistry } from './mcp.js';
import { runToolLoop } from './tool-loop.js';
import { buildToolEvidence } from './tool-evidence.js';
import { search } from "./search.js";
import { AppTools } from './app-tools.js';
import { resolveSearchContext, shouldPrefetchWeb } from './search-context.js';
import { isPictureRequest } from './image-search.js';
import { generateLittleGuy, GuyTools, validateProfile, mascotOptions } from './little-guys.js';
import { desktopApps } from './desktop-apps.js';
import { flushInferenceStats } from './inference-stats.js';
import { warmModelPrefixes } from './warmup.js';
import { remoteMcp } from './remote-mcp.js';
import { DiscoverableTools } from './tool-discovery.js';
import { fileFolders } from './file-folders.js';

database.init();

const app = express();
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (_req, res) => {
  res.json({ status: "ok", llama_cpp: await healthCheck(), model: LLM_MODEL_NAME, mcp: mcpRegistry.status });
});

app.get('/tools', async (_req, res) => {
  try { res.json({ tools: await new AppTools({ webEnabled: true }).catalog(), servers: mcpRegistry.status }); }
  catch { res.status(503).json({ detail: 'Invalid MCP configuration' }); }
});

// Connector mutations are owner UI actions, never exposed as model tools.
app.use('/connectors', (req, res, next) => {
  if (req.method !== 'GET' && req.headers.origin && !CORS_ORIGINS.includes(req.headers.origin)) return res.status(403).json({ detail: 'Open connector settings from Bonfire' });
  next();
});
app.get('/connectors', async (_req, res) => {
  try { res.json(await remoteMcp.list()); } catch { res.status(503).json({ detail: 'Could not unlock connector storage for this Windows account' }); }
});
app.post('/connectors', async (req, res) => {
  try { res.json(await remoteMcp.add(req.body)); } catch (error) { res.status(400).json({ detail: error.message }); }
});
app.post('/connectors/:id/connect', async (req, res) => {
  try { res.json(await remoteMcp.connect(req.params.id)); } catch (error) { res.status(400).json({ detail: error.message }); }
});
app.put('/connectors/:id/tools', async (req, res) => {
  try { res.json(await remoteMcp.setTools(req.params.id, req.body.tools)); } catch (error) { res.status(400).json({ detail: error.message }); }
});
app.post('/connectors/:id/disconnect', async (req, res) => {
  try { await remoteMcp.disconnect(req.params.id); res.json({ ok: true }); } catch (error) { res.status(400).json({ detail: error.message }); }
});
app.delete('/connectors/:id', async (req, res) => {
  try { await remoteMcp.disconnect(req.params.id, true); res.json({ ok: true }); } catch (error) { res.status(400).json({ detail: error.message }); }
});
app.post('/connectors/:id/call', async (req, res) => {
  try {
    const connector = (await remoteMcp.list()).find(item => item.id === req.params.id);
    const tool = connector?.tools.find(item => item.name === req.body.tool && connector.allowed_tools.includes(item.name));
    if (!tool) return res.status(400).json({ detail: 'Enable this tool before trying it' });
    const controller = new AbortController(); res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const result = await remoteMcp.call(tool.native_name, req.body.arguments || {}, { signal: controller.signal });
    res.json(result);
  } catch (error) { res.status(502).json({ detail: error.message }); }
});
app.get('/connectors/oauth/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  let success = false;
  try { if (!req.query.error) { await remoteMcp.finish(req.query.state, req.query.code); success = true; } } catch { /* Never expose authorization codes or provider diagnostics. */ }
  res.status(success ? 200 : 400).send(`<!doctype html><html><head><title>Bonfire · Notion connection</title><style>body{background:#100d18;color:#e8ddff;font:18px system-ui;max-width:540px;margin:15vh auto;padding:24px}a{color:#bc9aff}</style></head><body><h1>${success ? 'Your tools are here.' : 'Sign-in didn’t finish.'}</h1><p>${success ? 'Return to Tools & connectors in Bonfire to choose tools and assign them to a little guy.' : 'Return to Bonfire and connect again. The sign-in may have expired or been cancelled.'}</p><a href="${CORS_ORIGINS[0] || 'http://127.0.0.1:3000'}">Return to Bonfire</a></body></html>`);
});

app.get('/little-guys', (_req, res) => res.json(database.listLittleGuys()));
app.use('/file-folders', (req, res, next) => {
  if (req.method !== 'GET' && req.headers.origin && !CORS_ORIGINS.includes(req.headers.origin)) return res.status(403).json({ detail: 'Open folder settings from Bonfire' });
  next();
});
app.get('/file-folders', async (_req, res) => { try { res.json(await fileFolders.list()); } catch { res.status(503).json({ detail: 'Could not read configured folders' }); } });
app.post('/file-folders', async (req, res) => { try { res.json(await fileFolders.add(req.body)); } catch (error) { res.status(400).json({ detail: error.code ? 'Folder could not be opened. Check the path and permissions.' : error.message }); } });
app.delete('/file-folders/:id', async (req, res) => {
  try {
    await fileFolders.remove(req.params.id);
    for (const guy of database.listLittleGuys()) {
      if (!guy.folder_access?.some(access => access.folder_id === req.params.id)) continue;
      const { id, created_at, updated_at, ...profile } = guy;
      profile.folder_access = profile.folder_access.filter(access => access.folder_id !== req.params.id);
      if (!profile.folder_access.length) profile.allowed_tools = profile.allowed_tools.filter(name => !name.startsWith('files__'));
      database.saveLittleGuy(profile, id);
    }
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ detail: error.message }); }
});
app.get('/little-guys/options', (_req, res) => res.json(mascotOptions));
app.post('/little-guys/generate', async (req, res) => {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try { res.json(await generateLittleGuy(req.body, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]) })); }
  catch (error) { if (!controller.signal.aborted) res.status(502).json({ detail: error.message }); }
});
async function saveGuy(req, res) {
  try {
    if (req.params.id && !database.getLittleGuy(req.params.id)) return res.status(404).json({ detail: 'Little guy not found' });
    const profile = validateProfile(req.body, await new AppTools({ webEnabled: true }).catalog(), await desktopApps.list(), await fileFolders.list());
    res.json(database.saveLittleGuy(profile, req.params.id));
  } catch (error) { res.status(400).json({ detail: error.message }); }
}
app.post('/little-guys', saveGuy);
app.put('/little-guys/:id', saveGuy);
app.delete('/little-guys/:id', (req, res) => { database.deleteLittleGuy(req.params.id); res.json({ ok: true }); });
app.get('/apps', async (_req, res) => {
  try { res.json(await desktopApps.list()); } catch (error) { res.status(503).json({ detail: error.message }); }
});
app.post('/apps', async (req, res) => {
  try { res.json(await desktopApps.save(req.body)); } catch (error) { res.status(400).json({ detail: error.message }); }
});
app.delete('/apps/:id', async (req, res) => {
  try {
    await desktopApps.remove(req.params.id);
    for (const guy of database.listLittleGuys()) {
      if (!guy.allowed_apps.includes(req.params.id)) continue;
      const { id, created_at, updated_at, ...profile } = guy;
      profile.allowed_apps = profile.allowed_apps.filter(appId => appId !== req.params.id);
      if (!profile.allowed_apps.length) profile.allowed_tools = profile.allowed_tools.filter(name => name !== 'desktop__launch_app');
      database.saveLittleGuy(profile, id);
    }
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ detail: error.message }); }
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
  const existing = req.body?.conversation_id ? database.getConversation(req.body.conversation_id) : null;
  if (req.body?.conversation_id && !existing) return res.status(404).json({ detail: 'Conversation not found' });
  if (existing && req.body.agent_id !== undefined && (req.body.agent_id || null) !== (existing.agent_id || null)) return res.status(400).json({ detail: 'Start a new chat to switch little guys' });
  const agentId = existing ? existing.agent_id : req.body?.agent_id || null;
  const guy = agentId ? database.getLittleGuy(agentId) : null;
  if (agentId && !guy) return res.status(410).json({ detail: 'This little guy was deleted. Start a new chat.' });
  const webEnabled = req.body?.search_enabled !== false;

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
  let userMessageId, assistantMessageId;
  const tools = new AppTools({ webEnabled, emit: send });
  const sources = tools.sources;
  const images = tools.images;
  const toolActivity = [];

  try {
    if (!conversationId) {
      const title = titleFromMessage(message);
      conversationId = database.createConversation(title, agentId);
      send("conversation", { conversation_id: conversationId, title, agent_id: agentId });
    }

    userMessageId = database.addMessage({ conversationId, role: "user", content: message });
    const storedMessages = database.getConversationMessages(conversationId);
    const history = await selectTokenHistory(storedMessages, countTokens, { signal: abortController.signal });

    // Prefetch clear current/verification requests; other requests let the model choose.
    // Images remain a native tool and never trigger text-search prefetch.
    let webContext = '';
    if (webEnabled && shouldPrefetchWeb(message) && !isPictureRequest(message, history)) {
      const context = await resolveSearchContext({ message, history, webEnabled: true, readPagesEnabled: false, signal: abortController.signal, emit: send });
      for (const source of context.sources) tools.addSource(source);
      tools.searchCalls++;
      webContext = context.webContext;
    }
    abortController.signal.throwIfAborted();
    const scopedTools = new GuyTools(tools, guy, guy?.allowed_tools.some(name => name.startsWith('desktop__')) ? await desktopApps.list() : []);
    const discoveredTools = new DiscoverableTools(scopedTools, { query: message, signal: abortController.signal });
    const catalog = await discoveredTools.fullCatalog();
    const toolContext = await discoveredTools.context();
    const toolEvidence = buildToolEvidence(storedMessages, catalog.map(tool => tool.function.name), guy?.folder_access || []);
    const assignedFolders = catalog.some(tool => tool.function.name.startsWith('files__')) ? (await fileFolders.list()).flatMap(folder => {
      const access = guy?.folder_access.find(item => item.folder_id === folder.id);
      return access ? [{ folder_id: folder.id, name: folder.name, root: folder.path, access: access.mode }] : [];
    }) : [];
    const folderContext = assignedFolders.length ? 'Configured assigned folders (use these IDs directly; the owner does not need to supply internal IDs):\n' + JSON.stringify(assignedFolders) : '';
    const llmMessages = buildChatMessages({ history, webContext: [webContext, toolContext, folderContext, toolEvidence].filter(Boolean).join('\n\n'), webEnabled, allowedTools: catalog.map(tool => tool.function.name), guy });
    send("status", "Generating answer...");

    await runToolLoop(llmMessages, {
      registry: discoveredTools,
      // File tasks need discovery, reads, dependent edits and verification/recovery.
      ...(catalog.some(tool => tool.function.name.startsWith('files__')) ? { maxCalls: 20, maxTurns: 16 } : {}),
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
      assistantMessageId = database.addMessage({
        conversationId,
        role: "assistant",
        content: assistantText,
        sources: sources.length ? JSON.stringify(sources) : null,
        toolActivity: toolActivity.length ? JSON.stringify(toolActivity) : null,
        images: images.length ? JSON.stringify(images) : null,
      });
      database.touchConversation(conversationId);
    }
    send("done", { conversation_id: conversationId, user_message_id: userMessageId, assistant_message_id: assistantMessageId });
    if (!clientGone && !res.destroyed && !res.writableEnded) res.end();
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Bonfire backend listening on http://${HOST}:${PORT}`);
});
mcpRegistry.catalog().catch(() => console.error('Invalid MCP configuration; check backend/mcp.json'));
void warmModelPrefixes().catch(() => console.log('Optional model warmup skipped; chat remains available.'));

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  void mcpRegistry.close();
  server.close(async () => {
    await flushInferenceStats();
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
