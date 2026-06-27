import { lazy, Suspense } from "react";
import { AlertCircle, CheckCircle2, FileText, Globe2, Loader2, Route, Sparkles } from "lucide-react";
import type { ActivityEvent, ActivityKind, DisplayMessage, SearchResultItem } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";

interface MessageBubbleProps {
  message: DisplayMessage;
  active?: boolean;
  activity?: ActivityEvent[];
}

const activityIcon: Record<ActivityKind, typeof Sparkles> = {
  route: Route,
  search: Globe2,
  read: FileText,
  generate: Sparkles,
  result: CheckCircle2,
  error: AlertCircle,
};

const MarkdownContent = lazy(() => import("./MarkdownContent"));

export default function MessageBubble({ message, active = false, activity = [] }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const hasContent = message.content.trim().length > 0;

  return (
    <Message align={isUser ? "end" : "start"} data-message-id={message.id} data-message-role={message.role}>
      <MessageContent>
        {!isUser && message.presetName && message.presetName !== "General" && (
          <MessageFooter className="px-0">
            <Badge variant="secondary" className="rounded-md">
              {message.presetName}
            </Badge>
          </MessageFooter>
        )}

        {active && activity.length > 0 && <ActivityPanel activity={activity} />}

        {hasContent && (
          <Bubble align={isUser ? "end" : "start"} variant={isUser ? "tinted" : "outline"} className={isUser ? "max-w-[78%]" : "max-w-full"}>
            <BubbleContent className={isUser ? "border-primary/20 bg-primary/20" : "border-border/70 bg-card/80"}>
              {isUser ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="prose-chat">
                  <Suspense fallback={<p className="whitespace-pre-wrap">{message.content}</p>}>
                    <MarkdownContent content={message.content} />
                  </Suspense>
                </div>
              )}
              {!isUser && message.sources && message.sources.length > 0 && <SourcePanel sources={message.sources} />}
            </BubbleContent>
          </Bubble>
        )}
      </MessageContent>
    </Message>
  );
}

function SourcePanel({ sources }: { sources: SearchResultItem[] }) {
  return (
    <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
      <p className="mb-2 font-medium text-foreground">Sources</p>
      <ul className="space-y-1.5">
        {sources.map((source, index) => (
          <li key={`${source.url}-${index}`} className="flex min-w-0 items-baseline gap-2">
            <span className="flex-none font-mono text-[11px] text-muted-foreground">[{index + 1}]</span>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="block min-w-0 truncate text-primary underline-offset-4 hover:underline"
            >
              {source.title || source.url}
            </a>
            {source.domain && <span className="hidden flex-none text-[11px] sm:inline">{source.domain}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActivityPanel({ activity }: { activity: ActivityEvent[] }) {
  const latest = activity[activity.length - 1];
  const visible = activity.slice(-4);
  const LatestIcon = activityIcon[latest.kind];

  return (
    <Bubble variant={latest.kind === "error" ? "destructive" : "muted"} className="max-w-full">
      <BubbleContent className="w-full border-border/70 bg-card/72">
        <div className="flex items-start gap-3" role="status" aria-live="polite" aria-atomic="false">
          <div className="grid size-9 flex-none place-items-center rounded-lg border bg-background/70 text-primary">
            {latest.kind === "generate" ? <Loader2 className="size-4 animate-spin" /> : <LatestIcon className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{latest.label}</p>
            {latest.detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{latest.detail}</p>}
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {visible.map((item) => {
            const Icon = activityIcon[item.kind];
            return (
              <Marker key={item.id} className="text-xs">
                <MarkerIcon>
                  <Icon className={item.kind === "error" ? "text-destructive" : "text-primary"} />
                </MarkerIcon>
                <MarkerContent className="truncate">
                  {item.label}
                  {item.detail ? ` - ${item.detail}` : ""}
                </MarkerContent>
              </Marker>
            );
          })}
        </div>
      </BubbleContent>
    </Bubble>
  );
}
