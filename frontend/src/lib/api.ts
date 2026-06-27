import type {
  ChatEvent,
  ConversationDetailOut,
  ConversationOut,
  FunnelStatus,
  Preset,
  Settings,
} from "./types";

function resolveBackendUrl() {
  const localBackend = "http://127.0.0.1:8000";
  const configuredBackend = import.meta.env.VITE_BACKEND_URL;
  if (configuredBackend) return configuredBackend;
  if (typeof window === "undefined") return localBackend;

  const host = window.location.hostname;
  if (host === "127.0.0.1" || host === "localhost") return localBackend;
  if (window.location.protocol === "https:" && host.endsWith(".ts.net")) return `https://${host}:8443`;
  return localBackend;
}

export const BACKEND_URL = resolveBackendUrl();

async function asJson<T>(res: Response, errorMessage: string): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = `: ${body.detail}`;
    } catch {
      // Status-only fallback for non-JSON errors.
    }
    throw new Error(`${errorMessage} (${res.status})${detail}`);
  }
  return res.json();
}

export async function fetchConversations(): Promise<ConversationOut[]> {
  return asJson(await fetch(`${BACKEND_URL}/conversations`), "Failed to load conversations");
}

export async function fetchConversation(id: string): Promise<ConversationDetailOut> {
  return asJson(await fetch(`${BACKEND_URL}/conversations/${id}`), "Failed to load conversation");
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/conversations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete conversation (${res.status})`);
}

export async function updateConversation(
  id: string,
  input: Partial<{ title: string; folder: string }>
): Promise<ConversationOut> {
  const res = await fetch(`${BACKEND_URL}/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson(res, "Failed to update conversation");
}

export async function clearAllChats(): Promise<{ conversations_deleted: number }> {
  const res = await fetch(`${BACKEND_URL}/conversations`, { method: "DELETE" });
  return asJson(res, "Failed to clear all chats");
}

export async function checkHealth(): Promise<{ status: string; llama_cpp: boolean }> {
  return asJson(await fetch(`${BACKEND_URL}/health`), "Backend health check failed");
}

export async function fetchPresets(): Promise<Preset[]> {
  return asJson(await fetch(`${BACKEND_URL}/presets`), "Failed to load presets");
}

export async function createPreset(input: {
  name: string;
  description: string;
  system_prompt: string;
  keywords: string[];
}): Promise<Preset> {
  const res = await fetch(`${BACKEND_URL}/presets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson(res, "Failed to create preset");
}

export async function updatePreset(
  id: string,
  input: Partial<{ name: string; description: string; system_prompt: string; keywords: string[] }>
): Promise<Preset> {
  const res = await fetch(`${BACKEND_URL}/presets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson(res, "Failed to update preset");
}

export async function deletePreset(id: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/presets/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete preset (${res.status})`);
}

export async function fetchSettings(): Promise<Settings> {
  return asJson(await fetch(`${BACKEND_URL}/settings`), "Failed to load settings");
}

export async function updateSettings(input: Partial<Settings>): Promise<Settings> {
  const res = await fetch(`${BACKEND_URL}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson(res, "Failed to update settings");
}

export async function fetchFunnelStatus(): Promise<FunnelStatus> {
  return asJson(await fetch(`${BACKEND_URL}/system/funnel`), "Failed to load Funnel status");
}

export async function setFunnelEnabled(enabled: boolean): Promise<Settings> {
  const res = await fetch(`${BACKEND_URL}/system/funnel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return asJson(res, "Failed to update Funnel");
}

export async function shutdownBonfire(): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/system/shutdown`, {
    method: "POST",
    keepalive: true,
  });
  if (!res.ok) throw new Error(`Failed to shut down Bonfire (${res.status})`);
}

export async function* streamChat(params: {
  conversationId: string | null;
  message: string;
  searchEnabled: boolean;
  presetId?: string | null;
  signal?: AbortSignal;
}): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${BACKEND_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversation_id: params.conversationId,
      message: params.message,
      search_enabled: params.searchEnabled,
      preset_id: params.presetId ?? null,
    }),
    signal: params.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Chat request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx >= 0) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line) yield JSON.parse(line) as ChatEvent;
      newlineIdx = buffer.indexOf("\n");
    }
  }

  if (buffer.trim()) yield JSON.parse(buffer.trim()) as ChatEvent;
}
