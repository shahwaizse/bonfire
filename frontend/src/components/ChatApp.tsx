import { useEffect, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import MessageBubble from "./MessageBubble";
import SettingsPanel from "./SettingsPanel";
import ComposerBar from "./ComposerBar";
import { Icon } from "./icons";
import {
  checkHealth,
  createPreset,
  deleteConversation,
  deletePreset,
  fetchConversation,
  fetchConversations,
  fetchPresets,
  fetchSettings,
  setFunnelEnabled as setFunnelEnabledApi,
  shutdownBonfire,
  streamChat,
  updateConversation,
  updatePreset,
  updateSettings,
} from "@/lib/api";
import type {
  ActivityEvent,
  ActivityKind,
  ConversationOut,
  DisplayMessage,
  MemoryReference,
  PageReadResult,
  Preset,
  SearchResultItem,
  Settings,
} from "@/lib/types";

const sidebarStorageKey = "bonfire-sidebar-collapsed";
const modelName = "Dolphin 3.0 Llama 3.1 8B";

function activityId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeActivity(kind: ActivityKind, label: string, detail?: string): ActivityEvent {
  return { id: activityId(), kind, label, detail };
}

function nowIso() {
  return new Date().toISOString();
}

function activityFromStatus(status: string): ActivityEvent {
  const lower = status.toLowerCase();
  if (lower.includes("search failed") || lower.includes("page read failed")) {
    return makeActivity("error", status);
  }
  if (lower.includes("remember") || lower.includes("memory")) {
    return makeActivity("memory", "Remembering", status);
  }
  if (lower.includes("search")) {
    return makeActivity("search", "Searching the web", status);
  }
  if (lower.includes("read")) {
    return makeActivity("read", "Reading source", status);
  }
  if (lower.includes("generating")) {
    return makeActivity("generate", "Writing response", status);
  }
  return makeActivity("generate", status);
}

export default function ChatApp() {
  const [conversations, setConversations] = useState<ConversationOut[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [llamaOnline, setLlamaOnline] = useState<boolean | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetOverride, setPresetOverride] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(() => new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const streamConversationIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const manualTitlesRef = useRef<Map<string, string>>(new Map());

  const presetNameById = (id: string | null | undefined) =>
    presets.find((preset) => preset.id === id)?.name ?? (id ? id[0].toUpperCase() + id.slice(1) : undefined);

  const pushActivity = (event: ActivityEvent) => {
    setActivity((current) => [...current.slice(-6), event]);
  };

  const refreshConversations = async () => {
    try {
      const list = await fetchConversations();
      setConversations(
        list.map((conversation) => ({
          ...conversation,
          title: manualTitlesRef.current.get(conversation.id) ?? conversation.title,
        }))
      );
    } catch {
      // Backend may still be starting.
    }
  };

  const upsertConversation = (conversation: ConversationOut) => {
    setConversations((current) => {
      const without = current.filter((item) => item.id !== conversation.id);
      return [conversation, ...without];
    });
  };

  const updateConversationTitle = (id: string, title: string) => {
    if (manualTitlesRef.current.has(id)) return;
    setConversations((current) =>
      current.map((conversation) => (conversation.id === id ? { ...conversation, title } : conversation))
    );
  };

  const refreshPresets = async () => {
    try {
      setPresets(await fetchPresets());
    } catch {
      // Best effort.
    }
  };

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(sidebarStorageKey) === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem(sidebarStorageKey, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    let ignore = false;

    const pollHealth = () => {
      checkHealth()
        .then((health) => {
          if (!ignore) setLlamaOnline(health.llama_cpp);
        })
        .catch(() => {
          if (!ignore) setLlamaOnline(false);
        });
    };

    fetchConversations()
      .then((list) => {
        if (!ignore) setConversations(list);
      })
      .catch(() => {});
    fetchPresets()
      .then((list) => {
        if (!ignore) setPresets(list);
      })
      .catch(() => {});
    fetchSettings()
      .then((nextSettings) => {
        if (!ignore) {
          setSettings(nextSettings);
          setSearchEnabled(nextSettings.search_default);
        }
      })
      .catch(() => {});
    pollHealth();
    const interval = window.setInterval(pollHealth, 15000);

    return () => {
      ignore = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activity]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const loadConversationMessages = async (id: string) => {
    const detail = await fetchConversation(id);
    setMessages(
      detail.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          id: String(message.id),
          role: message.role as "user" | "assistant",
          content: message.content,
          sources: message.sources ?? undefined,
          presetName: message.role === "assistant" ? presetNameById(message.preset_id) : undefined,
        }))
    );
  };

  const handleSelectConversation = async (id: string) => {
    setActiveId(id);
    activeIdRef.current = id;
    setSidebarOpen(false);
    if (streamConversationIdRef.current !== id) setActivity([]);
    await loadConversationMessages(id);
  };

  const handleNewChat = () => {
    setActiveId(null);
    activeIdRef.current = null;
    setMessages([]);
    setActivity([]);
    setSidebarOpen(false);
  };

  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id).catch(() => {});
    if (id === activeId) handleNewChat();
    refreshConversations();
  };

  const handleRenameConversation = async (id: string, title: string) => {
    manualTitlesRef.current.set(id, title);
    setConversations((current) =>
      current.map((conversation) => (conversation.id === id ? { ...conversation, title } : conversation))
    );
    try {
      const updated = await updateConversation(id, { title });
      setConversations((current) =>
        current.map((conversation) => (conversation.id === id ? updated : conversation))
      );
    } catch {
      refreshConversations();
    }
  };

  const handleMoveConversation = async (id: string, folder: string) => {
    setConversations((current) =>
      current.map((conversation) => (conversation.id === id ? { ...conversation, folder } : conversation))
    );
    try {
      const updated = await updateConversation(id, { folder });
      const manualTitle = manualTitlesRef.current.get(id);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === id ? { ...updated, title: manualTitle ?? updated.title } : conversation
        )
      );
    } catch {
      refreshConversations();
    }
  };

  const handleUpdateSettings = async (patch: Partial<Settings>) => {
    setSettings((previous) => (previous ? { ...previous, ...patch } : previous));
    try {
      setSettings(await updateSettings(patch));
    } catch {
      // Best effort.
    }
  };

  const handleSetFunnelEnabled = async (enabled: boolean) => {
    const previous = settings;
    setSettings((current) => (current ? { ...current, funnel_enabled: enabled } : current));
    try {
      setSettings(await setFunnelEnabledApi(enabled));
    } catch (error) {
      setSettings(previous);
      throw error;
    }
  };

  const handleShutdown = async () => {
    await shutdownBonfire();
  };

  const handleSavePreset = async (id: string, patch: Partial<Preset>) => {
    try {
      await updatePreset(id, patch);
      refreshPresets();
    } catch {
      // Best effort.
    }
  };

  const handleCreatePreset = async (draft: { name: string; description: string; system_prompt: string }) => {
    try {
      await createPreset({ ...draft, keywords: [] });
      refreshPresets();
    } catch {
      // Best effort.
    }
  };

  const handleDeletePreset = async (id: string) => {
    try {
      await deletePreset(id);
      if (presetOverride === id) setPresetOverride(null);
      refreshPresets();
    } catch {
      // Best effort.
    }
  };

  const updateLastAssistant = (patch: Partial<DisplayMessage> | ((message: DisplayMessage) => DisplayMessage)) => {
    if (activeIdRef.current !== streamConversationIdRef.current) return;
    setMessages((current) => {
      const copy = [...current];
      const last = copy[copy.length - 1];
      if (!last || last.role !== "assistant") return current;
      copy[copy.length - 1] = typeof patch === "function" ? patch(last) : { ...last, ...patch };
      return copy;
    });
  };

  const addSourcesToLastAssistant = (sources: SearchResultItem[]) => {
    updateLastAssistant((message) => ({ ...message, sources }));
  };

  const addMemoriesToLastAssistant = (memories: MemoryReference[]) => {
    updateLastAssistant((message) => ({ ...message, memorySources: memories }));
  };

  const handlePageRead = (page: PageReadResult) => {
    pushActivity(makeActivity("read", page.title || "Read source", page.url));
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    stopRequestedRef.current = false;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    streamConversationIdRef.current = activeId;
    if (activeId) {
      setGeneratingIds((current) => new Set(current).add(activeId));
    }
    setActivity([makeActivity("route", "Preparing request")]);

    const userMessage: DisplayMessage = { id: `local-user-${Date.now()}`, role: "user", content: text };
    const assistantMessage: DisplayMessage = { id: `local-assistant-${Date.now()}`, role: "assistant", content: "" };
    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      for await (const event of streamChat({
        conversationId: activeId,
        message: text,
        searchEnabled,
        presetId: presetOverride,
        signal: abortController.signal,
      })) {
        switch (event.type) {
          case "conversation":
            upsertConversation({
              id: event.data.conversation_id,
              title: event.data.title || "New chat",
              folder: "",
              created_at: nowIso(),
              updated_at: nowIso(),
            });
            setGeneratingIds((current) => {
              const next = new Set(current);
              next.add(event.data.conversation_id);
              return next;
            });
            if (activeIdRef.current === null) {
              setActiveId(event.data.conversation_id);
              activeIdRef.current = event.data.conversation_id;
            }
            streamConversationIdRef.current = event.data.conversation_id;
            break;
          case "conversation_title":
            updateConversationTitle(event.data.conversation_id, event.data.title);
            break;
          case "preset":
            pushActivity(makeActivity("route", `Using ${event.data.name}`, "Prompt selected"));
            updateLastAssistant({ presetName: event.data.name });
            break;
          case "status":
            pushActivity(activityFromStatus(event.data));
            break;
          case "memory":
            addMemoriesToLastAssistant(event.data);
            pushActivity(makeActivity("memory", `Used ${event.data.length} memories`, event.data[0]?.text));
            break;
          case "memory_update": {
            const created = event.data.created.length;
            const archived = event.data.archived.length;
            if (created || archived) {
              const label = created && archived ? "Memory updated" : created ? "Memory saved" : "Memory archived";
              const detail = event.data.created[0]?.text ?? event.data.archived[0]?.text;
              pushActivity(makeActivity("memory", label, detail));
            }
            break;
          }
          case "search_results":
            addSourcesToLastAssistant(event.data);
            pushActivity(makeActivity("result", `Found ${event.data.length} results`, event.data[0]?.title));
            break;
          case "page_read":
            handlePageRead(event.data);
            break;
          case "token":
            updateLastAssistant((message) => ({ ...message, content: message.content + event.data }));
            break;
          case "error":
            pushActivity(makeActivity("error", event.data));
            updateLastAssistant((message) => ({
              ...message,
              content: message.content + `\n\n_Error: ${event.data}_`,
            }));
            break;
          case "done":
            pushActivity(makeActivity("result", "Answer ready"));
            break;
        }
      }
    } catch (error) {
      if (stopRequestedRef.current || abortController.signal.aborted) {
        pushActivity(makeActivity("result", "Generation stopped"));
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      pushActivity(makeActivity("error", message));
      updateLastAssistant((last) => ({
        ...last,
        content: last.content + `\n\n_Error: ${message}_`,
      }));
    } finally {
      const completedConversationId = streamConversationIdRef.current;
      setIsStreaming(false);
      abortControllerRef.current = null;
      stopRequestedRef.current = false;
      streamConversationIdRef.current = null;
      setActivity([]);
      if (completedConversationId) {
        setGeneratingIds((current) => {
          const next = new Set(current);
          next.delete(completedConversationId);
          return next;
        });
      }
      if (completedConversationId && activeIdRef.current === completedConversationId) {
        await loadConversationMessages(completedConversationId).catch(() => {});
      }
      refreshConversations();
    }
  };

  const handleStop = () => {
    if (!abortControllerRef.current) return;
    stopRequestedRef.current = true;
    pushActivity(makeActivity("result", "Stopping generation"));
    abortControllerRef.current.abort();
  };

  return (
    <div className="relative flex h-screen overflow-hidden bg-bg text-ink">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
        onMoveToFolder={handleMoveConversation}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        llamaOnline={llamaOnline}
        modelName={modelName}
        generatingIds={generatingIds}
        onOpenSettings={() => {
          setSidebarOpen(false);
          setSettingsOpen(true);
        }}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="absolute left-3 top-3 z-20 grid h-10 w-10 place-items-center rounded-lg border border-line bg-surface/90 text-ink-dim shadow-[0_14px_40px_rgba(0,0,0,0.34)] backdrop-blur transition hover:border-line-strong hover:text-ink sm:hidden"
          aria-label="Open conversations"
          title="Open conversations"
        >
          <Icon name="menu" className="h-4 w-4" />
        </button>

        {messages.length === 0 ? (
          <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 pt-16">
            <div className="mb-6 w-full max-w-[780px] px-3 text-center">
              <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Sic parvis magna</h1>
            </div>
            <div className="w-full">
              <ComposerBar
                value={input}
                onChange={setInput}
                onSend={handleSend}
                onStop={handleStop}
                disabled={isStreaming}
                isStreaming={isStreaming}
                searchEnabled={searchEnabled}
                onSearchEnabledChange={setSearchEnabled}
                presets={presets}
                presetOverride={presetOverride}
                onPresetOverrideChange={setPresetOverride}
                autoFocus
              />
            </div>
          </main>
        ) : (
          <>
            <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-16 sm:px-6 sm:pt-6">
              <div className="mx-auto flex max-w-[820px] flex-col gap-4">
                {messages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    active={isStreaming && index === messages.length - 1 && message.role === "assistant"}
                    activity={activity}
                  />
                ))}
                <div ref={bottomRef} />
              </div>
            </main>
            <footer className="flex-none pt-1">
              <ComposerBar
                value={input}
                onChange={setInput}
                onSend={handleSend}
                onStop={handleStop}
                disabled={isStreaming}
                isStreaming={isStreaming}
                searchEnabled={searchEnabled}
                onSearchEnabledChange={setSearchEnabled}
                presets={presets}
                presetOverride={presetOverride}
                onPresetOverrideChange={setPresetOverride}
              />
            </footer>
          </>
        )}
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        llamaOnline={llamaOnline}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onSetFunnelEnabled={handleSetFunnelEnabled}
        onShutdown={handleShutdown}
        presets={presets}
        onSavePreset={handleSavePreset}
        onCreatePreset={handleCreatePreset}
        onDeletePreset={handleDeletePreset}
      />
    </div>
  );
}
