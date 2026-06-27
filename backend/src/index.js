import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { PORT, HOST, CORS_ORIGINS, DEFAULT_GUARDRAILS, LLM_TEMPERATURE, MAX_PAGES_TO_READ } from "./config.js";
import { database } from "./db.js";
import { ensureBuiltinPresets, GENERAL_ID, pickPreset } from "./presets.js";
import { buildSystemPrompt, buildWebContext, selectRecentHistory } from "./prompting.js";
import { healthCheck, streamChatCompletion } from "./llama.js";
import { search as searxngSearch } from "./search.js";
import { readPage } from "./page-reader.js";
import { funnelStatus, scheduleShutdown, setFunnelEnabled } from "./system-control.js";

const SETTINGS_KEYS = [
  "prompt_mode",
  "active_preset_id",
  "custom_prompt",
  "core_system_prompt",
  "search_default",
  "guardrails",
  "funnel_enabled",
  "llm_temperature",
];

const SETTINGS_DEFAULTS = {
  prompt_mode: "auto",
  active_preset_id: GENERAL_ID,
  custom_prompt: "",
  core_system_prompt: "",
  search_default: "false",
  guardrails: DEFAULT_GUARDRAILS,
  funnel_enabled: "false",
  llm_temperature: String(LLM_TEMPERATURE),
};

database.init();
ensureBuiltinPresets(database);

const app = express();
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (_req, res) => {
  res.json({ status: "ok", llama_cpp: await healthCheck() });
});

app.get("/conversations", (_req, res) => {
  res.json(database.listConversations());
});

app.delete("/conversations", (_req, res) => {
  const count = database.clearConversations();
  res.json({ ok: true, conversations_deleted: count });
});

app.get("/conversations/:id", (req, res) => {
  const conversation = database.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ detail: "Conversation not found" });
  const messages = database.getConversationMessages(req.params.id).map((message) => ({
    ...message,
    sources: parseJson(message.sources, null),
  }));
  res.json({ ...conversation, messages });
});

app.patch("/conversations/:id", (req, res) => {
  const updates = {};
  if (typeof req.body?.title === "string") updates.title = req.body.title.trim() || "Untitled conversation";
  if (typeof req.body?.folder === "string") updates.folder = req.body.folder.trim();
  const conversation = database.updateConversation(req.params.id, updates);
  if (!conversation) return res.status(404).json({ detail: "Conversation not found" });
  res.json(conversation);
});

app.delete("/conversations/:id", (req, res) => {
  database.deleteConversation(req.params.id);
  res.json({ ok: true });
});

app.get("/settings", (_req, res) => {
  res.json(getSettings());
});

app.put("/settings", (req, res) => {
  const allowed = new Set(SETTINGS_KEYS);
  for (const [key, value] of Object.entries(req.body || {})) {
    if (!allowed.has(key)) continue;
    database.setSetting(key, typeof value === "boolean" ? String(value) : String(value));
  }
  res.json(getSettings());
});

app.get("/system/funnel", (_req, res) => {
  res.json({ saved_enabled: getSettings().funnel_enabled, ...funnelStatus() });
});

app.post("/system/funnel", (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    setFunnelEnabled(enabled);
    database.setSetting("funnel_enabled", String(enabled));
    res.json(getSettings());
  } catch (error) {
    res.status(502).json({ detail: `Failed to update Tailscale Funnel: ${error.message}` });
  }
});

app.post("/system/shutdown", (_req, res) => {
  scheduleShutdown();
  res.json({ ok: true });
});

app.get("/presets", (_req, res) => {
  res.json(database.listPresets().map(presetOut));
});

app.post("/presets", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const systemPrompt = String(req.body?.system_prompt || "").trim();
  if (!name || !systemPrompt) return res.status(400).json({ detail: "Preset name and system prompt are required" });
  const slug = slugify(name);
  const id = database.getPreset(slug) ? `${slug}-${randomUUID().slice(0, 6)}` : slug;
  database.upsertPreset({
    id,
    name,
    description: String(req.body?.description || "").trim(),
    systemPrompt,
    keywords: Array.isArray(req.body?.keywords) ? req.body.keywords : [],
  });
  res.json(presetOut(database.getPreset(id)));
});

app.put("/presets/:id", (req, res) => {
  const existing = database.getPreset(req.params.id);
  if (!existing) return res.status(404).json({ detail: "Preset not found" });
  const updates = {};
  if (typeof req.body?.name === "string") updates.name = req.body.name.trim();
  if (typeof req.body?.description === "string") updates.description = req.body.description.trim();
  if (typeof req.body?.system_prompt === "string") updates.system_prompt = req.body.system_prompt;
  if (Array.isArray(req.body?.keywords)) updates.keywords = req.body.keywords;
  database.updatePreset(req.params.id, updates);
  res.json(presetOut(database.getPreset(req.params.id)));
});

app.delete("/presets/:id", (req, res) => {
  if (req.params.id === GENERAL_ID) return res.status(400).json({ detail: "Cannot delete the General preset" });
  database.deletePreset(req.params.id);
  res.json({ ok: true });
});

app.post("/search", async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();
    if (!query) return res.status(400).json({ detail: "Query is required" });
    const requestedMax = Number(req.body?.max_results);
    const results = await searxngSearch(query, Number.isFinite(requestedMax) ? requestedMax : undefined);
    res.json({ query, results });
  } catch (error) {
    res.status(502).json({ detail: `SearXNG request failed: ${error.message}` });
  }
});

app.post("/read-page", async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url) return res.status(400).json({ detail: "URL is required" });
    res.json(await readPage(url));
  } catch (error) {
    res.status(502).json({ detail: `Failed to read page: ${error.message}` });
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
    if (clientGone || res.destroyed || res.writableEnded) return;
    res.write(`${JSON.stringify({ type, data })}\n`);
  };

  let conversationId = req.body?.conversation_id || null;
  let assistantText = "";
  let presetId = GENERAL_ID;
  let sources = [];

  try {
    const settings = getSettings();
    const allPresets = database.listPresets();
    const preset = resolvePreset({ requestedId: req.body?.preset_id, settings, presets: allPresets, message });
    presetId = preset.id;
    const systemPrompt = buildSystemPrompt(
      preset.system_prompt,
      settings.guardrails,
      settings.core_system_prompt
    );

    if (!conversationId) {
      const title = titleFromMessage(message);
      conversationId = database.createConversation(title);
      send("conversation", { conversation_id: conversationId, title });
    }

    database.addMessage({ conversationId, role: "user", content: message });
    send("preset", { id: preset.id, name: preset.name });

    const history = database.getConversationMessages(conversationId);
    const llmMessages = [{ role: "system", content: systemPrompt }];

    if (Boolean(req.body?.search_enabled)) {
      send("status", "Searching web...");
      try {
        sources = await searxngSearch(buildSearchQuery(message, history));
        if (sources.length) {
          send("search_results", sources);
          send("status", "Reading sources...");
          const pageReads = await readSearchPages(sources);
          for (const page of pageReads) send("page_read", page);
          llmMessages.push({ role: "system", content: buildWebContext(sources, pageReads) });
        }
      } catch (error) {
        send("status", `Web search failed: ${error.message}`);
      }
    }

    llmMessages.push(...selectRecentHistory(history));
    send("status", "Generating answer...");

    for await (const token of streamChatCompletion(llmMessages, {
      temperature: settings.llm_temperature,
      signal: abortController.signal,
    })) {
      assistantText += token;
      send("token", token);
    }
  } catch (error) {
    if (error.name !== "AbortError") send("error", `llama.cpp request failed: ${error.message}`);
  } finally {
    if (conversationId && assistantText.trim()) {
      database.addMessage({
        conversationId,
        role: "assistant",
        content: assistantText,
        presetId,
        sources: sources.length ? JSON.stringify(sources) : null,
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

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

function getSettings() {
  const raw = database.getSettings(SETTINGS_KEYS);
  const merged = Object.fromEntries(
    SETTINGS_KEYS.map((key) => [key, raw[key] == null ? SETTINGS_DEFAULTS[key] : raw[key]])
  );
  return {
    prompt_mode: merged.prompt_mode,
    active_preset_id: merged.active_preset_id,
    custom_prompt: merged.custom_prompt,
    core_system_prompt: merged.core_system_prompt,
    search_default: merged.search_default === "true",
    guardrails: merged.guardrails,
    funnel_enabled: merged.funnel_enabled === "true",
    llm_temperature: clampNumber(merged.llm_temperature, LLM_TEMPERATURE, 0, 2),
  };
}

function resolvePreset({ requestedId, settings, presets, message }) {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  if (requestedId && byId.has(requestedId)) return byId.get(requestedId);
  if (settings.prompt_mode === "custom" && settings.custom_prompt.trim()) {
    return {
      id: "custom",
      name: "Custom",
      system_prompt: settings.custom_prompt,
      keywords: "[]",
    };
  }
  if (settings.prompt_mode === "preset" && byId.has(settings.active_preset_id)) {
    return byId.get(settings.active_preset_id);
  }
  return pickPreset(message, presets);
}

function presetOut(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    system_prompt: row.system_prompt,
    keywords: parseJson(row.keywords, []),
    is_builtin: Boolean(row.is_builtin),
  };
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID().slice(0, 8);
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
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

function buildSearchQuery(message, history) {
  const current = message.replace(/\s+/g, " ").trim();
  const lower = current.toLowerCase();
  const words = new Set(lower.split(/\s+/).map((word) => word.replace(/[.,!?;:()[\]{}"'`]/g, "")));
  const referential = ["it", "its", "they", "them", "that", "this", "those", "these", "he", "she", "his", "her"].some(
    (word) => words.has(word)
  );
  if (current.length > 120 && !referential) return current.slice(0, 320);
  const previousUser = [...history]
    .reverse()
    .find((item) => item.role === "user" && item.content && item.content !== message);
  return previousUser ? `${previousUser.content} ${current}`.slice(0, 320) : current.slice(0, 320);
}

async function readSearchPages(results) {
  const pages = results.filter((result) => result.url).slice(0, MAX_PAGES_TO_READ);
  const settled = await Promise.allSettled(pages.map((result) => readPage(result.url)));
  return settled.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
}
