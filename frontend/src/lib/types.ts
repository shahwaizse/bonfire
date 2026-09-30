export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  kind?: "web";
  source?: string | null;
  domain?: string | null;
  published_date?: string | null;
  score?: number | null;
}

export interface PageReadResult {
  title: string;
  url: string;
  requested_url?: string;
  excerpt: string;
}

export interface ImageResultItem {
  url: string;
  thumbnail: string;
  source_url: string;
  title: string;
  description: string;
  source?: string | null;
  query?: string;
}

export type ChatEvent =
  | { type: "conversation"; data: { conversation_id: string; title?: string } }
  | { type: "status"; data: string }
  | { type: "search_results"; data: SearchResultItem[] }
  | { type: 'image_results'; data: ImageResultItem[] }
  | { type: "page_read"; data: PageReadResult }
  | { type: "token"; data: string }
  | { type: "tool_call"; data: { id: string; name: string; arguments: Record<string, unknown> } }
  | { type: "tool_result"; data: { id: string; name: string; isError: boolean; summary: string } }
  | { type: "error"; data: string }
  | { type: "done"; data: { conversation_id: string | null } };

export interface MessageOut {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: SearchResultItem[] | null;
  tool_activity?: Extract<ChatEvent, { type: 'tool_call' | 'tool_result' }>[] | null;
  images?: ImageResultItem[] | null;
  created_at: string;
}

export interface ConversationOut {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetailOut extends ConversationOut {
  messages: MessageOut[];
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SearchResultItem[];
  toolActivity?: Extract<ChatEvent, { type: 'tool_call' | 'tool_result' }>[];
  images?: ImageResultItem[];
}

export type ActivityKind = "search" | "read" | "generate" | "result" | "error";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
}
