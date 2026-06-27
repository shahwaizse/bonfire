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
    model: "local",
    messages,
    temperature,
    top_p: LLM_TOP_P,
    min_p: LLM_MIN_P,
    repeat_penalty: LLM_REPEAT_PENALTY,
    cache_prompt: true,
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

export async function* streamChatCompletion(messages, { temperature = LLM_TEMPERATURE, signal } = {}) {
  const payload = { ...basePayload(messages, temperature), stream: true };
  const response = await fetch(`${LLAMA_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`llama.cpp returned ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      const token = parseSseLine(line);
      if (token) yield token;
      newline = buffer.indexOf("\n");
    }
  }
}

function parseSseLine(line) {
  if (!line.startsWith("data:")) return "";
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return "";
  try {
    const chunk = JSON.parse(data);
    return chunk?.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}
