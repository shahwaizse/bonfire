import { FormEvent, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { ConversationOut } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

export default function Sidebar(props: SidebarProps) {
  return (
    <>
      <aside
        className={`hidden h-dvh min-h-dvh flex-none border-r bg-sidebar/88 backdrop-blur-xl transition-[width] duration-200 sm:flex ${
          props.collapsed ? "w-[72px]" : "w-[292px]"
        }`}
        aria-label="Chat sidebar"
      >
        <SidebarContent {...props} mobile={false} />
      </aside>

      <Sheet open={props.mobileOpen} onOpenChange={(open) => !open && props.onCloseMobile()}>
        <SheetContent side="left" className="w-[292px] gap-0 p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Conversations</SheetTitle>
          </SheetHeader>
          <SidebarContent {...props} collapsed={false} mobile />
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarContent({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  onRename,
  onMoveToFolder,
  onCloseMobile,
  collapsed,
  onToggleCollapsed,
  llamaOnline,
  modelName,
  generatingIds,
  onOpenSettings,
  mobile,
}: SidebarProps & { mobile: boolean }) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");

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

  const startRename = (conversation: ConversationOut) => {
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title || "Untitled conversation");
    setMovingId(null);
  };

  const submitRename = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!renamingId) return;
    const nextTitle = renameDraft.trim();
    if (nextTitle) await onRename(renamingId, nextTitle);
    setRenamingId(null);
    setRenameDraft("");
  };

  const openMove = (conversation: ConversationOut) => {
    setMovingId(conversation.id);
    setFolderDraft(conversation.folder || "");
  };

  const submitMove = async (event: FormEvent) => {
    event.preventDefault();
    if (!movingId) return;
    await onMoveToFolder(movingId, folderDraft.trim());
    setMovingId(null);
    setFolderDraft("");
  };

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex flex-none items-center gap-2 p-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              onClick={onNewChat}
              className={collapsed && !mobile ? "w-10 px-0" : "flex-1"}
              variant="secondary"
              aria-label="New chat"
            >
              <Plus />
              <span className={collapsed && !mobile ? "sr-only" : "truncate"}>New chat</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>

        {!mobile && (
          <Button
            type="button"
            onClick={onToggleCollapsed}
            variant="outline"
            size="icon"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        )}

        {mobile && (
          <Button type="button" onClick={onCloseMobile} variant="outline" size="icon" aria-label="Close sidebar">
            <X />
          </Button>
        )}
      </div>

      {!collapsed && (
        <div className="px-3 pb-3">
          <label className="sr-only" htmlFor="chat-search">
            Search chats
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="chat-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              className="pl-8"
            />
          </div>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1 px-2">
        {collapsed && !mobile && (
          <div className="px-1">
            <div
              className={`relative grid h-10 w-full place-items-center rounded-lg ${
                activeId ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground"
              }`}
              title="Chats"
            >
              <MessageSquare className="size-4" />
              {generatingIds.size > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-primary" />}
            </div>
          </div>
        )}

        {!collapsed && (
          <div className="space-y-4 pb-3">
            {conversations.length === 0 && <p className="px-2 py-4 text-sm text-muted-foreground">No conversations yet.</p>}
            {conversations.length > 0 && groups.length === 0 && (
              <p className="px-2 py-4 text-sm text-muted-foreground">No chats match your search.</p>
            )}

            {groups.map((group) => (
              <section key={group.name} aria-label={group.name}>
                <div className="mb-1.5 flex items-center gap-2 px-2 text-[11px] font-medium text-muted-foreground">
                  {group.name === "Recent" ? <MessageSquare className="size-3.5" /> : <Folder className="size-3.5" />}
                  <h2 className="truncate">{group.name}</h2>
                </div>
                <ul className="space-y-0.5">
                  {group.conversations.map((conversation) => (
                    <li key={conversation.id} className="relative">
                      {renamingId === conversation.id ? (
                        <form onSubmit={submitRename} className="rounded-lg border bg-background p-1">
                          <Input
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setRenamingId(null);
                              }
                            }}
                            onBlur={() => void submitRename()}
                            autoFocus
                            aria-label="Conversation title"
                            className="h-8 border-0 bg-transparent"
                          />
                        </form>
                      ) : (
                        <div className="group flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onSelect(conversation.id)}
                            className={`min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                              conversation.id === activeId
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
                            }`}
                            aria-current={conversation.id === activeId ? "page" : undefined}
                            aria-label={conversation.title || "Untitled conversation"}
                            title={conversation.title || "Untitled conversation"}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="block min-w-0 flex-1 truncate">
                                {conversation.title || "Untitled conversation"}
                              </span>
                              {generatingIds.has(conversation.id) && (
                                <span className="size-2 flex-none rounded-full bg-primary" aria-hidden="true" />
                              )}
                            </span>
                          </button>

                          <DropdownMenu onOpenChange={(open) => !open && setMovingId(null)}>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                                aria-label={`Actions for ${conversation.title || "conversation"}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                              {movingId === conversation.id ? (
                                <form onSubmit={submitMove} className="space-y-2 p-1">
                                  <label className="block text-xs text-muted-foreground" htmlFor={`folder-${conversation.id}`}>
                                    Folder name
                                  </label>
                                  <Input
                                    id={`folder-${conversation.id}`}
                                    value={folderDraft}
                                    onChange={(event) => setFolderDraft(event.target.value)}
                                    placeholder="Project, Research, Ideas..."
                                    autoFocus
                                  />
                                  <div className="flex items-center gap-2">
                                    <Button type="submit" size="sm">
                                      Move
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        void onMoveToFolder(conversation.id, "");
                                        setMovingId(null);
                                      }}
                                    >
                                      Clear
                                    </Button>
                                  </div>
                                </form>
                              ) : (
                                <>
                                  <DropdownMenuItem onClick={() => startRename(conversation)}>
                                    <Pencil />
                                    Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={(event) => {
                                      event.preventDefault();
                                      openMove(conversation);
                                    }}
                                  >
                                    <Folder />
                                    Move to folder
                                  </DropdownMenuItem>
                                  <DropdownMenuItem variant="destructive" onClick={() => onDelete(conversation.id)}>
                                    <Trash2 />
                                    Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </ScrollArea>

      <Separator />
      <div className="flex flex-none flex-col gap-2 p-3">
        <div
          className={`flex h-9 items-center rounded-lg border px-2.5 text-xs transition-colors ${
            llamaOnline
              ? "border-emerald-400/30 bg-emerald-400/8 text-emerald-100 shadow-[0_0_22px_rgba(52,211,153,0.12)]"
              : "border-destructive/25 bg-destructive/8 text-destructive"
          } ${collapsed && !mobile ? "justify-center px-0" : "justify-between"}`}
          role="status"
          aria-label={llamaOnline ? "llama.cpp online" : "llama.cpp offline"}
        >
          <span className={collapsed && !mobile ? "sr-only" : "truncate"}>{modelName}</span>
          <Badge
            variant={llamaOnline ? "secondary" : "destructive"}
            className={`size-2 rounded-full p-0 ${
              llamaOnline ? "border-emerald-300 bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.9)]" : ""
            }`}
            aria-hidden="true"
          />
        </div>
        <Button
          type="button"
          onClick={onOpenSettings}
          variant="outline"
          className={collapsed && !mobile ? "justify-center px-0" : "justify-start"}
          aria-label="Settings"
        >
          <Settings />
          <span className={collapsed && !mobile ? "sr-only" : ""}>Settings</span>
        </Button>
      </div>
    </div>
  );
}
