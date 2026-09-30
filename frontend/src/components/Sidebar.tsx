import { FormEvent, useState } from "react";
import { MessageSquare, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import type { ConversationOut } from "@/lib/types";
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

interface SidebarProps {
  conversations: ConversationOut[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void> | void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  llamaOnline: boolean | null;
  modelName: string;
  generatingIds: Set<string>;
}

export default function Sidebar(props: SidebarProps) {
  return (
    <>
      <aside className="hidden h-dvh min-h-dvh w-[292px] flex-none border-r bg-sidebar/88 backdrop-blur-xl sm:flex" aria-label="Chat sidebar">
        <SidebarContent {...props} mobile={false} />
      </aside>

      <Sheet open={props.mobileOpen} onOpenChange={(open) => !open && props.onCloseMobile()}>
        <SheetContent side="left" className="w-[292px] gap-0 p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Conversations</SheetTitle>
          </SheetHeader>
          <SidebarContent {...props} mobile />
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
  onCloseMobile,
  llamaOnline,
  modelName,
  generatingIds,
  mobile,
}: SidebarProps & { mobile: boolean }) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const startRename = (conversation: ConversationOut) => {
    setRenamingId(conversation.id);
    setRenameDraft(conversation.title || "Untitled conversation");
  };

  const submitRename = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!renamingId) return;

    const nextTitle = renameDraft.trim();
    if (nextTitle) await onRename(renamingId, nextTitle);
    setRenamingId(null);
    setRenameDraft("");
  };

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex flex-none items-center gap-2 p-3">
        <Button type="button" onClick={onNewChat} className="flex-1" variant="secondary" aria-label="New chat">
          <Plus />
          <span className="truncate">New chat</span>
        </Button>

        {mobile && (
          <Button type="button" onClick={onCloseMobile} variant="outline" size="icon" aria-label="Close sidebar">
            <X />
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="space-y-4 pb-3">
          <section aria-label="Recent chats">
            <div className="mb-1.5 flex items-center gap-2 px-2 text-[11px] font-medium text-muted-foreground">
              <MessageSquare className="size-3.5" />
              <h2 className="truncate">Recent</h2>
            </div>

            {conversations.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">No conversations yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {conversations.map((conversation) => (
                  <li key={conversation.id} className="group relative">
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
                      <div className="relative w-full min-w-0">
                        <button
                          type="button"
                          onClick={() => onSelect(conversation.id)}
                          className={`w-full min-w-0 overflow-hidden rounded-lg py-2 pl-2.5 pr-10 text-left text-sm transition-colors ${
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

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100"
                              aria-label={`Actions for ${conversation.title || "conversation"}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => startRename(conversation)}>
                              <Pencil />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => onDelete(conversation.id)}>
                              <Trash2 />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </ScrollArea>

      <Separator />
      <div className="flex flex-none flex-col gap-2 p-3">
        <div
          className={`flex h-9 items-center justify-between rounded-lg border px-2.5 text-xs transition-colors ${
            llamaOnline
              ? "border-emerald-400/30 bg-emerald-400/8 text-emerald-100 shadow-[0_0_22px_rgba(52,211,153,0.12)]"
              : "border-destructive/25 bg-destructive/8 text-destructive"
          }`}
          role="status"
          aria-label={llamaOnline ? "llama.cpp online" : "llama.cpp offline"}
        >
          <span className="truncate">{modelName}</span>
          <span
            className={`size-2 rounded-full ${llamaOnline ? "bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.9)]" : "bg-destructive"}`}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
