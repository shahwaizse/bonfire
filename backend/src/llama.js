import {
  LLAMA_BASE_URL,
  LLM_MAX_TOKENS,
  LLM_MIN_P,
  LLM_REPEAT_PENALTY,
  LLM_TEMPERATURE,
  LLM_TOP_P,
} from "./config.js";

function basePayload(messages, temperature) {
  const payload = {
    model: "qwen",
    messages,
    temperature,
    top_p: LLM_TOP_P,
    top_k: 0,
    min_p: LLM_MIN_P,
    repeat_penalty: LLM_REPEAT_PENALTY,
    cache_prompt: true,
    chat_template_kwargs: { enable_thinking: false },
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

export async function* streamCompletionTurn(messages, { temperature = LLM_TEMPERATURE, signal, tools = [] } = {}) {
  const payload = { ...basePayload(messages, temperature), stream: true,
    ...(tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: false } : {}) };
  const response = await fetch(`${LLAMA_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`llama.cpp returned ${response.status}`);

  yield* parseCompletionStream(response.body);
}

export async function* streamChatCompletion(messages, options) {
  for await (const choice of streamCompletionTurn(messages, options)) {
    if (choice.delta?.content) yield choice.delta.content;
  }
}

export async function* parseCompletionStream(body) {
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
      const choice = parseSseLine(line);
      if (choice) yield choice;
      newline = buffer.indexOf("\n");
    }
    if (done) {
      const choice = parseSseLine(buffer.trim());
      if (choice) yield choice;
      break;
    }
  } } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function parseSseLine(line) {
  if (!line.startsWith("data:")) return "";
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return "";
  const chunk = JSON.parse(data);
  if (chunk.error) throw new Error(chunk.error.message || 'Model stream failed');
  return chunk?.choices?.[0] || null;
}
