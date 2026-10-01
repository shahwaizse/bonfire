import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, Flame, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Plug, Settings2, Sparkles, Trash2, X } from "lucide-react";
import type { ConversationOut, LittleGuy } from "@/lib/types";
import LittleGuyMascot from "./LittleGuyMascot";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarProps {
  conversations: ConversationOut[];
  guys: LittleGuy[];
  guyId: string | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: (guyId: string | null) => void;
  onCreateGuy: () => void;
  onEditGuy: (id: string) => void;
  onManageGuys: () => void;
  onManageTools: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void> | void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  llamaOnline: boolean | null;
  modelName: string;
  generatingIds: Set<string>;
  chatBusy: boolean;
}
type ChatGroup = { id: string; name: string; guy?: LittleGuy; chats: ConversationOut[]; archived?: boolean };
const plainGroup = "bonfire";
const collapsedKey = "bonfire-sidebar-collapsed";
const groupStateKey = "bonfire-sidebar-groups";
function readGroups(): Record<string, boolean> {
  try { const value = JSON.parse(localStorage.getItem(groupStateKey) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
}

export default function Sidebar(props: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(collapsedKey) === "true");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(readGroups);
  const activeGroup = props.conversations.find(item => item.id === props.activeId)?.agent_id || plainGroup;
  useEffect(() => { localStorage.setItem(collapsedKey, String(collapsed)); }, [collapsed]);
  useEffect(() => { localStorage.setItem(groupStateKey, JSON.stringify(expanded)); }, [expanded]);
  useEffect(() => {
    if (!props.activeId) return;
    setExpanded(current => ({ ...current, [activeGroup]: true }));
  }, [props.activeId, activeGroup]);
  const groups: ChatGroup[] = props.guys.map(guy => ({ id: guy.id, name: guy.name, guy, chats: props.conversations.filter(chat => chat.agent_id === guy.id) }));
  groups.push({ id: plainGroup, name: "Bonfire", chats: props.conversations.filter(chat => !chat.agent_id) });
  const retiredIds = [...new Set(props.conversations.filter(chat => chat.agent_id && !props.guys.some(guy => guy.id === chat.agent_id)).map(chat => chat.agent_id!))];
  for (const id of retiredIds) groups.push({ id, name: "Retired little guy", archived: true, chats: props.conversations.filter(chat => chat.agent_id === id) });
  const toggleGroup = (id: string) => setExpanded(current => ({ ...current, [id]: !(current[id] ?? false) }));
  const revealGroup = (id: string) => { setCollapsed(false); setExpanded(current => ({ ...current, [id]: true })); };
  const content = { ...props, groups, expanded, toggleGroup, revealGroup, collapsed, setCollapsed };
  return <TooltipProvider delayDuration={180}>
    <aside className={`hidden h-dvh min-h-dvh flex-none border-r bg-sidebar/90 backdrop-blur-xl transition-[width] duration-200 sm:flex ${collapsed ? "w-[76px]" : "w-[312px]"}`} aria-label="Little guys and chats">
      <SidebarContent {...content} mobile={false} />
    </aside>
    <Sheet open={props.mobileOpen} onOpenChange={open => !open && props.onCloseMobile()}>
      <SheetContent side="left" className="gap-0 p-0 data-[side=left]:w-[min(312px,90vw)]" showCloseButton={false}>
        <SheetHeader className="sr-only"><SheetTitle>Little guys and chats</SheetTitle></SheetHeader>
        <SidebarContent {...content} mobile />
      </SheetContent>
    </Sheet>
  </TooltipProvider>;
}

function SidebarContent({ groups, expanded, toggleGroup, revealGroup, collapsed, setCollapsed, mobile, ...props }: SidebarProps & {
  groups: ChatGroup[]; expanded: Record<string, boolean>; toggleGroup: (id: string) => void; revealGroup: (id: string) => void;
  collapsed: boolean; setCollapsed: (value: boolean) => void; mobile: boolean;
}) {
  const compact = collapsed && !mobile;
  const selectedGroup = props.guyId || plainGroup;
  return <div className="flex min-h-0 w-full flex-1 flex-col">
    <div className={`flex h-[72px] flex-none items-center ${compact ? "justify-center" : "gap-2 px-4"}`}>
      {!compact && <><Flame className="size-5 text-primary" /><span className="flex-1 text-lg font-semibold tracking-tight">bonfire<span className="text-primary">.</span></span></>}
      <Button variant="ghost" size="icon-sm" aria-label={mobile ? "Close sidebar" : compact ? "Expand sidebar" : "Collapse sidebar"} title={mobile ? "Close sidebar" : compact ? "Expand sidebar" : "Collapse sidebar"} onClick={() => mobile ? props.onCloseMobile() : setCollapsed(!collapsed)}>
        {mobile ? <X /> : compact ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>
    </div>
    <div className={`flex flex-none ${compact ? "justify-center px-2" : "px-3 pb-4"}`}>
      <Tooltip><TooltipTrigger asChild><Button variant="secondary" className={compact ? "size-11 rounded-xl p-0" : "h-10 w-full justify-start rounded-xl"} aria-label="New Bonfire chat" disabled={props.chatBusy} onClick={() => props.onNewChat(null)}><Plus />{!compact && <span>New chat</span>}</Button></TooltipTrigger>{compact && <TooltipContent side="right">New Bonfire chat</TooltipContent>}</Tooltip>
    </div>
    <ScrollArea className={`min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block! ${compact ? "px-2 pt-4" : "px-3"}`}>
      {!compact && <div className="mb-3 flex items-center justify-between px-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground"><span>Your little guys</span></div>}
      <div className={compact ? "space-y-3 pb-4" : "space-y-2 pb-4"}>
        {groups.map(group => {
          const open = expanded[group.id] ?? false;
          const selected = selectedGroup === group.id;
          const running = group.chats.some(chat => props.generatingIds.has(chat.id));
          const avatar = group.guy ? <LittleGuyMascot recipe={group.guy.mascot} label={group.name} size={compact ? 46 : 48} /> : <Flame className={`${compact ? "size-7" : "size-6"} ${group.archived ? "text-muted-foreground" : "text-primary"}`} />;
          if (compact) return <Tooltip key={group.id}><TooltipTrigger asChild><button type="button" onClick={() => revealGroup(group.id)} aria-label={`Show ${group.name} chats`} className={`relative flex w-full flex-col items-center rounded-2xl px-1 py-2 transition-colors hover:bg-sidebar-accent ${selected ? "bg-primary/10 ring-1 ring-primary/25" : ""}`}>
            <span className="flex h-11 items-center justify-center">{avatar}</span>

            {running && <span className="absolute right-1 top-1 size-1.5 animate-pulse rounded-full bg-primary" />}
          </button></TooltipTrigger><TooltipContent side="right"><span>{group.name}</span><span className="opacity-60">{group.chats.length} chats</span></TooltipContent></Tooltip>;
          return <section key={group.id} className={`overflow-hidden rounded-2xl border transition-colors ${selected ? "border-primary/25 bg-primary/[0.045]" : "border-transparent bg-card/25"}`} aria-label={`${group.name} chats`}>
            <div className="group flex items-center gap-0.5 pr-1.5">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 text-left hover:bg-sidebar-accent/40" onClick={() => toggleGroup(group.id)} aria-expanded={open} aria-controls={`${mobile ? "mobile" : "desktop"}-chats-${group.id}`}>
                <span className="flex size-12 flex-none items-center justify-center">{avatar}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{group.name}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{group.archived ? "Saved history" : group.guy ? `${group.guy.allowed_tools.length} tools` : "No little guy"}<span className="mx-1.5 opacity-50">·</span>{group.chats.length} {group.chats.length === 1 ? "chat" : "chats"}</span></span>
                <ChevronDown className={`mr-1 size-3.5 flex-none text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
              </button>
              {!group.archived && <Button variant="ghost" size="icon-sm" title={`New chat with ${group.name}`} aria-label={`New chat with ${group.name}`} disabled={props.chatBusy} onClick={() => { props.onNewChat(group.guy?.id || null); if (!open) toggleGroup(group.id); }}><Plus className="size-3.5" /></Button>}
              {group.guy && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Manage ${group.name}`}><MoreHorizontal className="size-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => props.onEditGuy(group.id)}><Settings2 />Edit little guy</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
            </div>
            <div id={`${mobile ? "mobile" : "desktop"}-chats-${group.id}`}>
              {open ? <div className="mb-2 mx-2">
                {group.chats.length ? <ul className="space-y-0.5">{group.chats.map(chat => <ChatRow key={chat.id} conversation={chat} {...props} />)}</ul> : <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">{group.guy ? "A little guy. A blank page." : "For everything else."}<br />Use + to start a chat.</p>}
              </div> : null}
            </div>
          </section>;
        })}
        {!props.guys.length && !compact && <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">Give your chats a little character.<br />Create your first guy below.</p>}
      </div>
    </ScrollArea>
    <div className={`flex flex-none flex-col gap-2 border-t ${compact ? "items-center p-2 py-3" : "p-3"}`}>
      <Tooltip><TooltipTrigger asChild><Button onClick={props.onCreateGuy} variant="outline" className={compact ? "size-11 rounded-xl border-dashed p-0" : "h-11 w-full justify-start rounded-xl border-dashed border-primary/30 text-primary hover:bg-primary/10"} aria-label="Create little guy"><Sparkles className="size-4" />{!compact && <span>Create little guy</span>}</Button></TooltipTrigger>{compact && <TooltipContent side="right">Create little guy</TooltipContent>}</Tooltip>
      <Tooltip><TooltipTrigger asChild><Button variant="ghost" onClick={props.onManageTools} size={compact ? "icon-sm" : "sm"} className={compact ? "" : "justify-start text-muted-foreground"} aria-label="Tools and connectors"><Plug />{!compact && <span>Tools & connectors</span>}</Button></TooltipTrigger>{compact && <TooltipContent side="right">Tools & connectors</TooltipContent>}</Tooltip>
      <Tooltip><TooltipTrigger asChild><Button variant="ghost" onClick={props.onManageGuys} size={compact ? "icon-sm" : "sm"} className={compact ? "" : "justify-start text-muted-foreground"} aria-label="Manage crew and app launchers"><Settings2 />{!compact && <span>Crew & app launchers</span>}</Button></TooltipTrigger>{compact && <TooltipContent side="right">Crew & app launchers</TooltipContent>}</Tooltip>
      <div className={`flex items-center text-[11px] text-muted-foreground ${compact ? "justify-center py-2" : "justify-between px-2 py-1"}`} role="status" title={`${props.modelName}: ${props.llamaOnline === null ? "checking" : props.llamaOnline ? "online" : "offline"}`} aria-label={`${props.modelName} ${props.llamaOnline === null ? "checking" : props.llamaOnline ? "online" : "offline"}`}>
        {!compact && <span>{props.modelName}</span>}<span className={`size-1.5 rounded-full ${props.llamaOnline === null ? "animate-pulse bg-muted-foreground" : props.llamaOnline ? "bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.5)]" : "bg-destructive"}`} />
      </div>
    </div>
  </div>;
}

function ChatRow({ conversation, activeId, onSelect, onDelete, onRename, generatingIds }: Pick<SidebarProps, "activeId" | "onSelect" | "onDelete" | "onRename" | "generatingIds"> & { conversation: ConversationOut }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(conversation.title || "Untitled chat");
  const submit = async (event?: FormEvent) => { event?.preventDefault(); if (draft.trim()) await onRename(conversation.id, draft.trim()); setRenaming(false); };
  return <li className="group/chat relative min-w-0">
    {renaming ? <form onSubmit={submit}><Input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setRenaming(false); } }} onBlur={() => void submit()} autoFocus aria-label="Conversation title" className="h-8 text-xs" /></form> : <>
      <button type="button" onClick={() => onSelect(conversation.id)} className={`flex w-full min-w-0 items-center gap-2 rounded-lg py-2 pl-2 pr-8 text-left text-xs transition-colors ${conversation.id === activeId ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`} aria-current={conversation.id === activeId ? "page" : undefined} title={conversation.title || "Untitled chat"}>
        <MessageSquare className="size-3 flex-none opacity-50" /><span className="min-w-0 flex-1 truncate">{conversation.title || "Untitled chat"}</span>{generatingIds.has(conversation.id) && <span className="size-1.5 flex-none animate-pulse rounded-full bg-primary" />}
      </button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="absolute right-0 top-1/2 size-7 -translate-y-1/2 sm:opacity-0 sm:group-hover/chat:opacity-100 sm:focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`Actions for ${conversation.title || "chat"}`}><MoreHorizontal className="size-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => { setDraft(conversation.title || "Untitled chat"); setRenaming(true); }}><Pencil />Rename</DropdownMenuItem><DropdownMenuItem variant="destructive" disabled={generatingIds.has(conversation.id)} onClick={() => onDelete(conversation.id)}><Trash2 />Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </>}
  </li>;
}
