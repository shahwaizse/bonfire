import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowDown, Menu, Sparkles } from "lucide-react";
import Sidebar from "./Sidebar";
import MessageBubble from "./MessageBubble";
import ComposerBar from "./ComposerBar";
import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
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
  PageReadResult,
  Preset,
  SearchResultItem,
  Settings,
} from "@/lib/types";

const sidebarStorageKey = "bonfire-sidebar-collapsed";
const modelName = "Dolphin 3.0 Llama 3.1 8B";
const SettingsPanel = lazy(() => import("./SettingsPanel"));

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
  if (lower.includes("failed")) return makeActivity("error", status);
  if (lower.includes("search")) return makeActivity("search", "Searching web", status);
  if (lower.includes("read")) return makeActivity("read", "Reading sources", status);
  if (lower.includes("generating")) return makeActivity("generate", "Writing response", status);
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
  const activeIdRef = useRef<string | null>(null);
  const streamConversationIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const manualTitlesRef = useRef<Map<string, string>>(new Map());

  const presetNameById = (id: string | null | undefined) =>
    presets.find((preset) => preset.id === id)?.name ?? (id ? id[0].toUpperCase() + id.slice(1) : undefined);

  const pushActivity = (event: ActivityEvent) => {
    setActivity((current) => [...current.slice(-5), event]);
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
    setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
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

    fetchConversations().then((list) => !ignore && setConversations(list)).catch(() => {});
    fetchPresets().then((list) => !ignore && setPresets(list)).catch(() => {});
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
    activeIdRef.current = activeId;
  }, [activeId]);

  const loadConversationMessages = async (id: string) => {
    const detail = await fetchConversation(id);
    const loaded = detail.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        id: String(message.id),
        role: message.role as "user" | "assistant",
        content: message.content,
        sources: message.sources ?? undefined,
        presetName: message.role === "assistant" ? presetNameById(message.preset_id) : undefined,
      }));
    setMessages(loaded);
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
      setConversations((current) => current.map((conversation) => (conversation.id === id ? updated : conversation)));
    } catch {
      refreshConversations();
    }
  };

  const handleMoveConversation = async (id: string, folder: string) => {
    setConversations((current) =>
      current.map((conversation) => (conversation.id === id ? { ...conversation, folder } : conversation))
    );
    try {
      await updateConversation(id, { folder });
      refreshConversations();
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

  const handleSavePreset = async (id: string, patch: Partial<Preset>) => {
    await updatePreset(id, patch).catch(() => {});
    refreshPresets();
  };

  const handleCreatePreset = async (draft: { name: string; description: string; system_prompt: string }) => {
    await createPreset({ ...draft, keywords: [] }).catch(() => {});
    refreshPresets();
  };

  const handleDeletePreset = async (id: string) => {
    await deletePreset(id).catch(() => {});
    if (presetOverride === id) setPresetOverride(null);
    refreshPresets();
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
            setGeneratingIds((current) => new Set(current).add(event.data.conversation_id));
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
          case "search_results":
            addSourcesToLastAssistant(event.data);
            pushActivity(makeActivity("result", `Found ${event.data.length} sources`, event.data[0]?.title));
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
      updateLastAssistant((last) => ({ ...last, content: last.content + `\n\n_Error: ${message}_` }));
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
    <div className="relative flex h-dvh min-h-dvh overflow-hidden bg-background text-foreground">
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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 flex-none items-center justify-between border-b bg-background/78 px-3 backdrop-blur-xl sm:hidden">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} aria-label="Open conversations">
            <Menu />
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="truncate text-sm font-medium">Bonfire</span>
          </div>
          <span className="size-10" aria-hidden="true" />
        </header>

        {messages.length === 0 ? (
          <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-8 pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:pb-8">
            <div className="mb-6 flex w-full max-w-[780px] flex-col items-center text-center">
              <h1 className="text-2xl font-semibold sm:text-3xl">Sic parvis magna</h1>
            </div>
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
          </main>
        ) : (
          <>
            <main className="flex min-h-0 flex-1 flex-col" aria-label="Messages">
            <MessageScrollerProvider>
              <MessageScroller className="flex-1">
                <MessageScrollerViewport data-testid="message-viewport">
                  <MessageScrollerContent className="mx-auto w-full max-w-[840px] gap-5 px-3 py-5 sm:px-6">
                    {messages.map((message, index) => (
                      <MessageScrollerItem key={message.id}>
                        <MessageBubble
                          message={message}
                          active={isStreaming && index === messages.length - 1 && message.role === "assistant"}
                          activity={activity}
                        />
                      </MessageScrollerItem>
                    ))}
                    <MessageScrollerItem scrollAnchor />
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton size="sm" className="gap-1.5 shadow-lg">
                  <ArrowDown className="size-4" />
                  <span className="ml-1 text-xs">Jump to latest</span>
                </MessageScrollerButton>
              </MessageScroller>
            </MessageScrollerProvider>
            </main>
            <footer className="flex-none border-t bg-background/78 px-0 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl sm:pb-3">
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

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            llamaOnline={llamaOnline}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onSetFunnelEnabled={handleSetFunnelEnabled}
            onShutdown={shutdownBonfire}
            onClearAllChats={() => {
              handleNewChat();
              refreshConversations();
            }}
            presets={presets}
            onSavePreset={handleSavePreset}
            onCreatePreset={handleCreatePreset}
            onDeletePreset={handleDeletePreset}
          />
        </Suspense>
      )}
    </div>
  );
}
