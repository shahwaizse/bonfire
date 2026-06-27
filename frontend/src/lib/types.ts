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
  excerpt: string;
}

export interface PresetEventData {
  id: string;
  name: string;
}

export type ChatEvent =
  | { type: "conversation"; data: { conversation_id: string; title?: string } }
  | { type: "conversation_title"; data: { conversation_id: string; title: string } }
  | { type: "preset"; data: PresetEventData }
  | { type: "status"; data: string }
  | { type: "search_results"; data: SearchResultItem[] }
  | { type: "page_read"; data: PageReadResult }
  | { type: "token"; data: string }
  | { type: "error"; data: string }
  | { type: "done"; data: { conversation_id: string | null } };

export interface MessageOut {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  preset_id?: string | null;
  sources?: SearchResultItem[] | null;
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
  presetName?: string;
}

export type ActivityKind = "route" | "search" | "read" | "generate" | "result" | "error";

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
  core_system_prompt: string;
  search_default: boolean;
  guardrails: string;
  funnel_enabled: boolean;
  llm_temperature: number;
}

export interface FunnelStatus {
  saved_enabled: boolean;
  installed: boolean;
  active: boolean;
  frontend: boolean;
  backend: boolean;
  error?: string | null;
}
