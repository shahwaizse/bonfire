import type { ChatEvent, ConversationDetailOut, ConversationOut, LittleGuy, LittleGuyProfile, DesktopApp, ToolCatalog } from "./types";

function resolveBackendUrl() {
  const localBackend = "http://127.0.0.1:8000";
  const configuredBackend = import.meta.env.VITE_BACKEND_URL;
  if (typeof window === "undefined") return configuredBackend || localBackend;

  const host = window.location.hostname;
  if (host === "127.0.0.1" || host === "localhost") return configuredBackend || localBackend;
  return configuredBackend || localBackend;
}

export const BACKEND_URL = resolveBackendUrl();

async function asJson<T>(res: Response, errorMessage: string): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = `: ${body.detail}`;
    } catch {
      // Keep the status-only fallback.
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

export async function updateConversation(id: string, input: Partial<{ title: string }>): Promise<ConversationOut> {
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

export async function checkHealth(): Promise<{ status: string; llama_cpp: boolean; model: string }> {
  return asJson(await fetch(`${BACKEND_URL}/health`), "Backend health check failed");
}

export async function* streamChat(params: {
  conversationId: string | null;
  message: string;
  searchEnabled: boolean;
  agentId?: string | null;
  signal?: AbortSignal;
}): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${BACKEND_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversation_id: params.conversationId,
      message: params.message,
      search_enabled: params.searchEnabled,
      agent_id: params.agentId,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Chat request failed: ${res.status}`);
  }
  if (!res.body) throw new Error('Chat response has no stream');

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

export async function fetchLittleGuys(): Promise<LittleGuy[]> { return asJson(await fetch(`${BACKEND_URL}/little-guys`), 'Could not load little guys'); }
export async function fetchTools(): Promise<ToolCatalog> { return asJson(await fetch(`${BACKEND_URL}/tools`), 'Could not load tools'); }
export async function fetchApps(): Promise<DesktopApp[]> { return asJson(await fetch(`${BACKEND_URL}/apps`), 'Could not load apps'); }
export async function saveLittleGuy(profile: LittleGuyProfile, id?: string): Promise<LittleGuy> {
  return asJson(await fetch(`${BACKEND_URL}/little-guys${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) }), 'Could not save little guy');
}
export async function removeLittleGuy(id: string): Promise<void> { await asJson(await fetch(`${BACKEND_URL}/little-guys/${id}`, { method: 'DELETE' }), 'Could not delete little guy'); }
export async function generateLittleGuy(input: { brief: string; body: string; palette: string; vibe: string }, signal?: AbortSignal): Promise<LittleGuyProfile> {
  return asJson(await fetch(`${BACKEND_URL}/little-guys/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal }), 'Could not generate little guy');
}
export async function saveApp(input: Omit<DesktopApp, 'id'>): Promise<DesktopApp> {
  return asJson(await fetch(`${BACKEND_URL}/apps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }), 'Could not configure app');
}
export async function removeApp(id: string): Promise<void> { await asJson(await fetch(`${BACKEND_URL}/apps/${id}`, { method: 'DELETE' }), 'Could not remove app'); }

export type ConnectorTool = { name: string; native_name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean; unavailable?: string };
export type RemoteConnector = { id: string; name: string; url: string; auth: string; status: string; error?: string; authorization_url?: string; allowed_tools: string[]; tools: ConnectorTool[] };
export async function fetchConnectors(): Promise<RemoteConnector[]> { return asJson(await fetch(`${BACKEND_URL}/connectors`), 'Could not load connectors'); }
export async function connectorAction<T = RemoteConnector>(path: string, method = 'POST', body?: unknown): Promise<T> {
  return asJson(await fetch(`${BACKEND_URL}/connectors${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), 'Connector request failed');
}
export async function fetchFileFolders(): Promise<import('./types').FileFolder[]> { return asJson(await fetch(`${BACKEND_URL}/file-folders`), 'Could not load folders'); }
export async function saveFileFolder(input: { name: string; path: string }): Promise<import('./types').FileFolder> { return asJson(await fetch(`${BACKEND_URL}/file-folders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }), 'Could not add folder'); }
export async function removeFileFolder(id: string): Promise<void> { await asJson(await fetch(`${BACKEND_URL}/file-folders/${id}`, { method: 'DELETE' }), 'Could not remove folder'); }
