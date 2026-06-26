import { FormEvent, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationOut } from "@/lib/types";
import { Icon } from "./icons";

interface SidebarProps {
  conversations: ConversationOut[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void> | void;
  onMoveToFolder: (id: string, folder: string) => Promise<void> | void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  llamaOnline: boolean | null;
  modelName: string;
  generatingIds: Set<string>;
  onOpenSettings: () => void;
}

type Group = {
  name: string;
  conversations: ConversationOut[];
};

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  onRename,
  onMoveToFolder,
  mobileOpen,
  onCloseMobile,
  collapsed,
  onToggleCollapsed,
  llamaOnline,
  modelName,
  generatingIds,
  onOpenSettings,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseMobile();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  useEffect(() => {
    if (!menuId) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuId]);

  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = conversations.filter((conversation) => {
      const haystack = `${conversation.title} ${conversation.folder || ""}`.toLowerCase();
      return !normalizedQuery || haystack.includes(normalizedQuery);
    });

    const map = new Map<string, ConversationOut[]>();
    for (const conversation of filtered) {
      const groupName = conversation.folder?.trim() || "Recent";
      const bucket = map.get(groupName) ?? [];
      bucket.push(conversation);
      map.set(groupName, bucket);
    }

    return [...map.entries()]
      .map(([name, groupConversations]) => ({ name, conversations: groupConversations }))
      .sort((a, b) => {
        if (a.name === "Recent") return -1;
        if (b.name === "Recent") return 1;
        return a.name.localeCompare(b.name);
      });
  }, [conversations, query]);

  const closeMenu = () => {
    setMenuId(null);
    setMovingId(null);
  };

  const startRename = (conversation: ConversationOut) => {
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title || "Untitled conversation");
    closeMenu();
  };

  const submitRename = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!renamingId) return;
    const nextTitle = renameDraft.trim();
    if (nextTitle) await onRename(renamingId, nextTitle);
    setRenamingId(null);
    setRenameDraft("");
  };

  const submitMove = async (event: FormEvent) => {
    event.preventDefault();
    if (!movingId) return;
    await onMoveToFolder(movingId, folderDraft.trim());
    closeMenu();
  };

  const openMove = (conversation: ConversationOut) => {
    setMovingId(conversation.id);
    setFolderDraft(conversation.folder || "");
  };

  const asideCollapsed = collapsed ? "sm:w-[72px]" : "sm:w-[292px]";

  return (
    <>
      <div
        onClick={onCloseMobile}
        className={`fixed inset-0 z-40 bg-black/64 transition-opacity sm:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[292px] flex-none transform flex-col border-r border-line bg-surface/96 backdrop-blur transition-[width,transform] duration-200 ease-out sm:static sm:z-auto sm:translate-x-0 ${asideCollapsed} ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Chat sidebar"
      >
        <div className="flex flex-none items-center gap-2 p-3">
          <button
            type="button"
            onClick={onNewChat}
            className={`flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm font-medium text-ink transition duration-150 hover:border-line-strong hover:bg-surface-3 active:scale-[0.98] ${
              collapsed ? "sm:w-10 sm:px-0" : "flex-1"
            }`}
            aria-label="New chat"
            title="New chat"
          >
            <Icon name="plus" className="h-4 w-4" />
            <span className={collapsed ? "sm:sr-only" : "truncate"}>New chat</span>
          </button>

          <button
            type="button"
            onClick={onToggleCollapsed}
            className="hidden h-10 w-10 flex-none place-items-center rounded-lg border border-line bg-bg-soft text-ink-dim transition hover:border-line-strong hover:text-ink sm:grid"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name={collapsed ? "chevronRight" : "chevronLeft"} className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onCloseMobile}
            className="grid h-10 w-10 flex-none place-items-center rounded-lg border border-line bg-bg-soft text-ink-dim transition hover:border-line-strong hover:text-ink sm:hidden"
            aria-label="Close sidebar"
            title="Close sidebar"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className={`px-3 pb-3 ${collapsed ? "sm:hidden" : ""}`}>
          <label className="sr-only" htmlFor="chat-search">
            Search chats
          </label>
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              id="chat-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              className="h-10 w-full rounded-lg border border-line bg-bg-soft pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-muted"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 && (
            <p className={`px-2 py-4 text-sm text-ink-muted ${collapsed ? "sm:hidden" : ""}`}>
              No conversations yet.
            </p>
          )}
          {conversations.length > 0 && groups.length === 0 && (
            <p className={`px-2 py-4 text-sm text-ink-muted ${collapsed ? "sm:hidden" : ""}`}>
              No chats match your search.
            </p>
          )}

          {collapsed && <CollapsedChatIcon active={Boolean(activeId)} generating={generatingIds.size > 0} />}
          <div className={`space-y-4 ${collapsed ? "sm:hidden" : ""}`}>
            {groups.map((group) => (
              <ConversationGroup
                key={group.name}
                group={group}
                activeId={activeId}
                menuId={menuId}
                renamingId={renamingId}
                renameDraft={renameDraft}
                movingId={movingId}
                folderDraft={folderDraft}
                generatingIds={generatingIds}
                menuRef={menuRef}
                onSelect={onSelect}
                onOpenMenu={(conversation) => {
                  setMenuId((current) => (current === conversation.id ? null : conversation.id));
                  setMovingId(null);
                }}
                onStartRename={startRename}
                onRenameDraftChange={setRenameDraft}
                onCancelRename={() => setRenamingId(null)}
                onSubmitRename={submitRename}
                onOpenMove={openMove}
                onFolderDraftChange={setFolderDraft}
                onSubmitMove={submitMove}
                onClearFolder={async (id) => {
                  await onMoveToFolder(id, "");
                  closeMenu();
                }}
                onDelete={(id) => {
                  onDelete(id);
                  closeMenu();
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-none flex-col gap-2 border-t border-line p-3">
          <div
            className={`flex h-9 items-center rounded-lg border border-line bg-bg-soft px-2.5 text-xs text-ink-dim ${
              collapsed ? "sm:justify-center sm:px-0" : "justify-between"
            }`}
          >
            <span className={collapsed ? "sm:hidden" : ""}>{modelName}</span>
            <span
              className={`h-2 w-2 rounded-full ${llamaOnline ? "bg-ok" : "bg-danger"}`}
              title={llamaOnline ? "llama.cpp online" : "llama.cpp offline"}
              aria-label={llamaOnline ? "llama.cpp online" : "llama.cpp offline"}
            />
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className={`flex h-10 items-center gap-2 rounded-lg border border-line bg-bg-soft px-3 text-sm text-ink-dim transition hover:border-line-strong hover:bg-surface-2 hover:text-ink ${
              collapsed ? "sm:justify-center sm:px-0" : ""
            }`}
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" className="h-4 w-4" />
            <span className={collapsed ? "sm:sr-only" : ""}>Settings</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function CollapsedChatIcon({
  active,
  generating,
}: {
  active: boolean;
  generating: boolean;
}) {
  return (
    <div className="hidden px-1 sm:block" aria-label="Chats">
      <div
        className={`relative grid h-10 w-full place-items-center rounded-lg ${
          active ? "bg-surface-3 text-ink" : "text-ink-muted"
        }`}
        title="Chats"
      >
        <Icon name="message" className="h-4 w-4" />
        {generating && (
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent-2 soft-pulse" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

function ConversationGroup({
  group,
  activeId,
  menuId,
  renamingId,
  renameDraft,
  movingId,
  folderDraft,
  generatingIds,
  menuRef,
  onSelect,
  onOpenMenu,
  onStartRename,
  onRenameDraftChange,
  onCancelRename,
  onSubmitRename,
  onOpenMove,
  onFolderDraftChange,
  onSubmitMove,
  onClearFolder,
  onDelete,
}: {
  group: Group;
  activeId: string | null;
  menuId: string | null;
  renamingId: string | null;
  renameDraft: string;
  movingId: string | null;
  folderDraft: string;
  generatingIds: Set<string>;
  menuRef: RefObject<HTMLDivElement | null>;
  onSelect: (id: string) => void;
  onOpenMenu: (conversation: ConversationOut) => void;
  onStartRename: (conversation: ConversationOut) => void;
  onRenameDraftChange: (value: string) => void;
  onCancelRename: () => void;
  onSubmitRename: (event?: FormEvent) => void;
  onOpenMove: (conversation: ConversationOut) => void;
  onFolderDraftChange: (value: string) => void;
  onSubmitMove: (event: FormEvent) => void;
  onClearFolder: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section aria-label={group.name}>
      <div className="mb-1.5 flex items-center gap-2 px-2 text-[11px] font-medium text-ink-muted">
        <Icon name={group.name === "Recent" ? "message" : "folder"} className="h-3.5 w-3.5" />
        <h2 className="truncate">{group.name}</h2>
      </div>
      <ul className="space-y-0.5">
        {group.conversations.map((conversation) => (
          <li key={conversation.id} className="relative">
            {renamingId === conversation.id ? (
              <form onSubmit={onSubmitRename} className="flex items-center gap-1 rounded-lg border border-accent bg-bg-soft p-1">
                <input
                  value={renameDraft}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelRename();
                    }
                  }}
                  onBlur={() => void onSubmitRename()}
                  autoFocus
                  aria-label="Conversation title"
                  className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-ink outline-none"
                />
              </form>
            ) : (
              <div className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={`min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    conversation.id === activeId
                      ? "bg-surface-3 text-ink"
                      : "text-ink-dim hover:bg-surface-2 hover:text-ink"
                  }`}
                  aria-current={conversation.id === activeId ? "page" : undefined}
                  aria-label={conversation.title || "Untitled conversation"}
                  title={conversation.title || "Untitled conversation"}
                >
                  <span className="flex min-w-0 items-center gap-2">
                      <span className="block min-w-0 flex-1 truncate">{conversation.title || "Untitled conversation"}</span>
                    {generatingIds.has(conversation.id) && (
                      <span className="h-2 w-2 flex-none rounded-full bg-accent-2 soft-pulse" aria-hidden="true" />
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenMenu(conversation)}
                  className="grid h-8 w-8 flex-none place-items-center rounded-md text-ink-muted opacity-0 transition hover:bg-surface-3 hover:text-ink group-hover:opacity-100 focus:opacity-100"
                  aria-haspopup="menu"
                  aria-expanded={menuId === conversation.id}
                  aria-label={`Actions for ${conversation.title || "conversation"}`}
                  title="Conversation actions"
                >
                  <Icon name="dots" className="h-4 w-4" />
                </button>
              </div>
            )}

            {menuId === conversation.id && (
              <div
                ref={menuRef}
                role="menu"
                className="absolute right-1 top-9 z-30 w-64 animate-surface-in rounded-lg border border-line bg-surface p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.5)]"
              >
                {movingId === conversation.id ? (
                  <form onSubmit={onSubmitMove} className="space-y-2 p-1">
                    <label className="block text-xs text-ink-muted" htmlFor={`folder-${conversation.id}`}>
                      Folder name
                    </label>
                    <input
                      id={`folder-${conversation.id}`}
                      value={folderDraft}
                      onChange={(event) => onFolderDraftChange(event.target.value)}
                      placeholder="Project, Research, Ideas..."
                      autoFocus
                      className="h-9 w-full rounded-md border border-line bg-bg-soft px-2.5 text-sm text-ink outline-none placeholder:text-ink-muted"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        className="h-8 rounded-md bg-ink px-3 text-xs font-medium text-bg transition hover:bg-white"
                      >
                        Move
                      </button>
                      <button
                        type="button"
                        onClick={() => onClearFolder(conversation.id)}
                        className="h-8 rounded-md border border-line px-3 text-xs text-ink-dim transition hover:border-line-strong hover:text-ink"
                      >
                        Clear
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <MenuButton icon="edit" label="Rename" onClick={() => onStartRename(conversation)} />
                    <MenuButton icon="folder" label="Move to folder" onClick={() => onOpenMove(conversation)} />
                    <MenuButton icon="trash" label="Delete" danger onClick={() => onDelete(conversation.id)} />
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MenuButton({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: "edit" | "folder" | "trash";
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition ${
        danger ? "text-danger hover:bg-danger/10" : "text-ink-dim hover:bg-surface-2 hover:text-ink"
      }`}
    >
      <Icon name={icon} className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}
