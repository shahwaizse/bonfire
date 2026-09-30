import { lazy, Suspense } from "react";
import type { ActivityEvent, DisplayMessage, SearchResultItem } from "@/lib/types";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import { faviconUrl, sourceDomain } from "@/lib/sources";
import ImageGallery from './ImageGallery';

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
        {active && activity.length > 0 && <ActivityPanel activity={activity} />}

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
                    <MarkdownContent content={message.content} sources={message.sources} />
                  </Suspense>
                </div>
              )}
              {!isUser && message.sources && message.sources.length > 0 && <SourcePanel sources={message.sources} />}
            </BubbleContent>
          </Bubble>
        )}
        {!isUser && Boolean(message.images?.length) && <ImageGallery images={message.images || []} />}
        {!isUser && Boolean(message.toolActivity?.length) && (
          <details className="mt-2 max-w-full rounded-lg border px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Tools used ({message.toolActivity?.filter(event => event.type === 'tool_call').length})</summary>
            <ul className="mt-2 space-y-2">
              {message.toolActivity?.map((event, index) => (
                <li key={`${event.data.id}-${index}`}>
                  <span className="font-medium">{event.data.name.replace('__', ' / ')}{event.type === 'tool_result' ? event.data.isError ? ' · Failed' : ' · Done' : ''}</span>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all">{event.type === 'tool_call' ? JSON.stringify(event.data.arguments) : event.data.summary}</pre>
                </li>
              ))}
            </ul>
          </details>
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
          <li key={`${source.url}-${index}`} className="flex min-w-0 items-center gap-2">
            <SourceFavicon source={source} />
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

function SourceFavicon({ source }: { source: SearchResultItem }) {
  const icon = faviconUrl(source);
  const label = sourceDomain(source);
  return (
    <span
      className="grid size-5 flex-none place-items-center rounded-md border bg-background/70"
      title={label || source.title || source.url}
      aria-hidden="true"
      data-testid="source-favicon"
    >
      {icon && (
        <img
          src={icon}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-3.5"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}
    </span>
  );
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
