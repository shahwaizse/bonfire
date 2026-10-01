import {
  LLAMA_BASE_URL,
  LLM_MODEL,
  LLM_MAX_TOKENS,
  LLM_MIN_P,
  LLM_REPEAT_PENALTY,
  LLM_TEMPERATURE,
  LLM_TOP_P,
} from "./config.js";
import { recordInferenceTurn } from './inference-stats.js';
import { createHash } from 'node:crypto';
import { acquireInference } from './inference-scheduler.js';
const tokenCounts = new Map();
let contextInfo;

async function contextSize(signal) {
  if (contextInfo && contextInfo.expires > Date.now()) return contextInfo.size;
  const response = await fetch(`${LLAMA_BASE_URL}/props`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
  if (!response.ok) throw Error('Could not read the model context size');
  const size = (await response.json()).default_generation_settings?.n_ctx;
  if (!Number.isInteger(size) || size < 512) throw Error('Model reported an invalid context size');
  contextInfo = { size, expires: Date.now() + 60000 }; return size;
}

export async function completionPromptTokens(payload, { signal } = {}) {
  const response = await fetch(`${LLAMA_BASE_URL}/apply-template`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error(`Could not format the model prompt (${response.status})`);
  const prompt = (await response.json()).prompt;
  if (typeof prompt !== 'string') throw Error('Model did not return a formatted prompt');
  // Server prompt tokens include its BOS; reserve a small margin for it and framing.
  return await countTokens(prompt, { signal }) + 32;
}

async function fitCompletionPayload(payload, signal) {
  const context = await contextSize(signal);
  const reserve = Math.min(payload.max_tokens || LLM_MAX_TOKENS || 2048, Math.floor(context / 4));
  const budget = context - reserve;
  payload.max_tokens = reserve;
  payload.messages = payload.messages.map(message => ({ ...message }));
  const fits = async () => await completionPromptTokens(payload, { signal }) <= budget;
  if (await fits()) return payload;
  // Drop old conversation turns, keeping the system, latest request and current tool round.
  let lastUser = payload.messages.findLastIndex(message => message.role === 'user');
  while (lastUser > 1) {
    let next = payload.messages.findIndex((message, index) => index > 1 && message.role === 'user');
    if (next < 0) next = lastUser;
    payload.messages.splice(1, next - 1);
    lastUser = payload.messages.findLastIndex(message => message.role === 'user');
    if (await fits()) return payload;
  }
  // Keep call/result pairs intact. Mark shortened evidence explicitly for the model.
  const results = payload.messages.filter(message => message.role === 'tool');
  for (let index = 0; index < results.length; index++) {
    const message = results[index], keep = index === results.length - 1 ? 2400 : 1000;
    if (typeof message.content !== 'string' || message.content.length <= keep) continue;
    message.content = JSON.stringify({ truncated: true, instruction: 'Evidence was shortened to fit context. Fetch a narrower result if details are missing.', text: message.content.slice(0, keep) });
    if (await fits()) return payload;
  }
  throw Error(`This request cannot fit the ${context}-token model context even after reducing old history and tool evidence. Use a narrower request or tool query.`);
}
export async function countTokens(content, { signal } = {}) {
  signal?.throwIfAborted();
  const key = createHash('sha256').update(LLM_MODEL).update(content).digest('hex');
  if (tokenCounts.has(key)) return tokenCounts.get(key);
  const response = await fetch(`${LLAMA_BASE_URL}/tokenize`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, add_special: false }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Tokenizer returned ${response.status}`);
  const count = (await response.json()).tokens.length;
  if (tokenCounts.size >= 512) tokenCounts.delete(tokenCounts.keys().next().value);
  tokenCounts.set(key, count); return count;
}

function basePayload(messages, temperature) {
  const payload = {
    model: LLM_MODEL,
    messages,
    temperature,
    top_p: LLM_TOP_P,
    top_k: 0,
    min_p: LLM_MIN_P,
    repeat_penalty: LLM_REPEAT_PENALTY,
    cache_prompt: true,
    chat_template_kwargs: { enable_thinking: false },
    timings_per_token: true,
  };
  if (LLM_MAX_TOKENS > 0) payload.max_tokens = LLM_MAX_TOKENS;
  return payload;
}

export async function healthCheck() {
  try {
    const response = await fetch(`${LLAMA_BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function* streamCompletionTurn(messages, { temperature = LLM_TEMPERATURE, signal, tools = [], priority = 0, maxTokens, recordStats = true } = {}) {
  const started = performance.now();
  const release = await acquireInference({ signal, priority });
  let timings, firstOutputMs = null, finishReason;
  let payload = { ...basePayload(messages, temperature), stream: true,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: true } : {}) };
  try {
    payload = await fitCompletionPayload(payload, signal);
    const response = await fetch(`${LLAMA_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`llama.cpp returned ${response.status}`);

    for await (const choice of parseCompletionStream(response.body, { onMetadata: data => { if (data.timings) timings = data.timings; } })) {
      if (firstOutputMs === null && (choice.delta?.content || choice.delta?.tool_calls?.length)) firstOutputMs = performance.now() - started;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      yield choice;
    }
  } finally { release(); if (recordStats) recordInferenceTurn({ timings, firstOutputMs, finishReason, wallMs: performance.now() - started }); }
}

export async function* streamChatCompletion(messages, options) {
  for await (const choice of streamCompletionTurn(messages, options)) {
    if (choice.delta?.content) yield choice.delta.content;
  }
}

export async function* parseCompletionStream(body, { onMetadata = () => {} } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try { while (true) {
    const { value, done } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    if (buffer.length > 1000000) throw new Error('Model stream frame is too large');

    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === 'data: [DONE]') return;
      const choice = parseSseLine(line, onMetadata);
      if (choice) yield choice;
      newline = buffer.indexOf("\n");
    }
    if (done) {
      const choice = parseSseLine(buffer.trim(), onMetadata);
      if (choice) yield choice;
      break;
    }
  } } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function parseSseLine(line, onMetadata) {
  if (!line.startsWith("data:")) return "";
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return "";
  const chunk = JSON.parse(data);
  if (chunk.error) throw new Error(chunk.error.message || 'Model stream failed');
  onMetadata(chunk);
  return chunk?.choices?.[0] || null;
}
