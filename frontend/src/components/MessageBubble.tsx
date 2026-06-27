import { lazy, Suspense } from "react";
import type { ActivityEvent, DisplayMessage, SearchResultItem } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { BACKEND_URL } from "@/lib/api";

interface MessageBubbleProps {
  message: DisplayMessage;
  active?: boolean;
  activity?: ActivityEvent[];
}

const MarkdownContent = lazy(() => import("./MarkdownContent"));

export default function MessageBubble({ message, active = false, activity = [] }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const hasContent = message.content.trim().length > 0;
  const hasSources = !isUser && (message.sources?.length ?? 0) > 0;

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

        {active && !hasContent && activity.length > 0 && <ActivityPanel activity={activity} />}

        {hasContent && (
          <Bubble
            align={isUser ? "end" : "start"}
            variant={isUser ? "default" : "outline"}
            className={isUser ? "max-w-[78%]" : hasSources ? "w-full max-w-full" : "max-w-full"}
          >
            <BubbleContent
              className={
                isUser
                  ? "border-primary/40 !bg-primary !text-primary-foreground shadow-lg shadow-primary/10"
                  : `border-border/70 bg-card/80 ${hasSources ? "w-full" : ""}`
              }
            >
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
  const imageSources = sources.filter((source) => source.kind === "image" && (source.thumbnail_url || source.image_url));
  const webSources = sources.filter((source) => source.kind !== "image");

  return (
    <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
      <p className="mb-2 font-medium text-foreground">Sources</p>
      {imageSources.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {imageSources.slice(0, 8).map((source, index) => {
            const imageUrl = source.thumbnail_url || source.image_url || "";
            const href = source.source_page_url || source.url || imageUrl;
            return (
              <a
                key={`${imageUrl}-${index}`}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="group relative block aspect-[4/3] overflow-hidden rounded-lg border bg-muted/35"
                title={source.title || source.domain || "Image result"}
              >
                <img
                  src={imageProxyUrl(imageUrl)}
                  alt={source.title || "Image result"}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                />
                {source.domain && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-background/82 px-2 py-1 text-[10px] text-foreground backdrop-blur">
                    {source.domain}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      )}
      {webSources.length > 0 && (
      <ul className="space-y-1.5">
        {webSources.map((source, index) => (
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
      )}
    </div>
  );
}

function imageProxyUrl(url: string) {
  return `${BACKEND_URL}/image-proxy?url=${encodeURIComponent(url)}`;
}

function ActivityPanel({ activity }: { activity: ActivityEvent[] }) {
  const latest = activity[activity.length - 1];
  const isError = latest.kind === "error";

  return (
    <div
      className={`flex max-w-full items-center gap-2 px-1 py-1 text-sm ${
        isError ? "text-destructive" : "text-muted-foreground"
      }`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        className={`size-1.5 flex-none rounded-full ${isError ? "bg-destructive" : "animate-pulse bg-primary"}`}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">{latest.label}</span>
    </div>
  );
}
