export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  kind?: "web" | "image";
  source?: string | null;
  domain?: string | null;
  thumbnail_url?: string | null;
  image_url?: string | null;
  width?: number | null;
  height?: number | null;
  published_date?: string | null;
  score?: number | null;
}

export interface PageReadResult {
  title: string;
  url: string;
  excerpt: string;
}

export interface PresetEventData {
  id: string;
  name: string;
}

export interface MemoryReference {
  id: string;
  text: string;
  kind: "semantic" | "preference" | "episodic" | "procedural";
  confidence: number;
  topics?: string[];
  entities?: string[];
}

export type ChatEvent =
  | { type: "conversation"; data: { conversation_id: string; title?: string } }
  | { type: "conversation_title"; data: { conversation_id: string; title: string } }
  | { type: "preset"; data: PresetEventData }
  | { type: "status"; data: string }
  | { type: "memory"; data: MemoryReference[] }
  | { type: "memory_update"; data: { created: MemoryReference[]; archived: MemoryReference[] } }
  | { type: "search_results"; data: SearchResultItem[] }
  | { type: "page_read"; data: PageReadResult }
  | { type: "token"; data: string }
  | { type: "error"; data: string }
  | { type: "done"; data: { conversation_id: string } };

export interface MessageOut {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  preset_id?: string | null;
  sources?: SearchResultItem[] | null;
  memory_ids?: string[] | null;
  created_at: string;
}

export interface ConversationOut {
  id: string;
  title: string;
  folder: string;
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
  memorySources?: MemoryReference[];
  presetName?: string;
}

export type ActivityKind = "route" | "memory" | "search" | "read" | "generate" | "result" | "error";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  keywords: string[];
  is_builtin: boolean;
}

export type PromptMode = "auto" | "preset" | "custom";

export interface Settings {
  prompt_mode: PromptMode;
  active_preset_id: string;
  custom_prompt: string;
  search_default: boolean;
  guardrails: string;
  memory_enabled: boolean;
  memory_auto_extract: boolean;
  funnel_enabled: boolean;
}

export interface FunnelStatus {
  saved_enabled: boolean;
  installed: boolean;
  active: boolean;
  frontend: boolean;
  backend: boolean;
  error?: string | null;
}

export interface MemoryItem {
  id: string;
  text: string;
  kind: "semantic" | "preference" | "episodic" | "procedural";
  scope: string;
  topics: string[];
  entities: string[];
  confidence: number;
  pinned: boolean;
  archived: boolean;
  source_conversation_id?: string | null;
  source_message_id?: number | null;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
  use_count: number;
}

export interface MemoryStatus {
  active: number;
  archived: number;
  chroma_available: boolean;
  chroma_count?: number | null;
}

export interface MemoryGraphNode {
  id: string;
  label: string;
  type: string;
  weight: number;
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
  label: string;
  weight: number;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}
