import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ActivityEvent, ActivityKind, DisplayMessage, SearchResultItem } from "@/lib/types";
import { Icon, type IconName } from "./icons";

interface MessageBubbleProps {
  message: DisplayMessage;
  active?: boolean;
  activity?: ActivityEvent[];
}

const activityIcon: Record<ActivityKind, IconName> = {
  route: "spark",
  memory: "brain",
  search: "globe",
  read: "archive",
  generate: "message",
  result: "search",
  error: "x",
};

export default function MessageBubble({ message, active = false, activity = [] }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const hasContent = message.content.trim().length > 0;

  if (isUser) {
    return (
      <article className="flex animate-surface-in justify-end">
        <div className="max-w-[88%] rounded-lg border border-line-strong bg-[#3a404a] px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink shadow-[0_10px_34px_rgba(0,0,0,0.18)] sm:max-w-[72%]">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </article>
    );
  }

  return (
    <article className="flex animate-surface-in justify-start">
      <div className="flex w-full max-w-[780px] flex-col gap-2">
        {message.presetName && message.presetName !== "General" && (
          <span className="w-fit rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
            {message.presetName}
          </span>
        )}

        {active && activity.length > 0 && <ActivityPanel activity={activity} />}

        {hasContent && (
          <div className="rounded-lg border border-line bg-surface px-4 py-3 text-ink shadow-[0_12px_40px_rgba(0,0,0,0.2)]">
            <div className="prose-chat">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
            {message.memorySources && message.memorySources.length > 0 && (
              <div className="mt-3 border-t border-line pt-3 text-xs text-ink-dim">
                <p className="mb-2 font-semibold text-ink">Memory</p>
                <ul className="space-y-1.5">
                  {message.memorySources.map((memory) => (
                    <li key={memory.id} className="flex min-w-0 items-start gap-2">
                      <Icon name="brain" className="mt-0.5 h-3.5 w-3.5 flex-none text-accent" />
                      <span className="min-w-0 leading-relaxed text-ink-dim">{memory.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {message.sources && message.sources.length > 0 && <SourcePanel sources={message.sources} />}
          </div>
        )}
      </div>
    </article>
  );
}

function SourcePanel({ sources }: { sources: SearchResultItem[] }) {
  const imageSources = sources.filter((source) => source.kind === "image" || source.image_url || source.thumbnail_url);
  const webSources = sources.filter((source) => !imageSources.includes(source));

  return (
    <div className="mt-3 border-t border-line pt-3 text-xs text-ink-dim">
      {imageSources.length > 0 && (
        <div className="mb-3">
          <p className="mb-2 font-semibold text-ink">Images</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {imageSources.map((source) => {
              const sourceIndex = sources.indexOf(source) + 1;
              const imageUrl = source.thumbnail_url || source.image_url;
              return (
                <a
                  key={`${source.url}-${sourceIndex}`}
                  href={source.url || source.image_url || imageUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="group min-w-0 overflow-hidden rounded-md border border-line bg-bg-soft transition hover:border-accent"
                >
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={source.title || "Search result image"}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="aspect-[4/3] w-full bg-surface-2 object-cover"
                    />
                  ) : (
                    <div className="grid aspect-[4/3] place-items-center bg-surface-2 text-ink-muted">
                      <Icon name="search" className="h-4 w-4" />
                    </div>
                  )}
                  <div className="min-w-0 px-2 py-1.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="flex-none font-mono text-[10px] text-ink-muted">[{sourceIndex}]</span>
                      <span className="min-w-0 truncate text-[11px] text-accent group-hover:underline">
                        {source.title || source.domain || "Image result"}
                      </span>
                    </div>
                    {(source.domain || source.source) && (
                      <p className="mt-0.5 truncate text-[10px] text-ink-muted">{source.domain || source.source}</p>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {webSources.length > 0 && (
        <div>
          <p className="mb-2 font-semibold text-ink">Sources</p>
          <ul className="space-y-1.5">
            {webSources.map((source) => {
              const sourceIndex = sources.indexOf(source) + 1;
              return (
                <li key={`${source.url}-${sourceIndex}`} className="flex min-w-0 items-baseline gap-2">
                  <span className="flex-none font-mono text-[11px] text-ink-muted">[{sourceIndex}]</span>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block min-w-0 truncate text-accent hover:underline"
                  >
                    {source.title || source.url}
                  </a>
                  {source.domain && <span className="hidden flex-none text-[11px] text-ink-muted sm:inline">{source.domain}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActivityPanel({ activity }: { activity: ActivityEvent[] }) {
  const latest = activity[activity.length - 1];
  const visible = activity.slice(-4);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-line bg-surface/92 px-3.5 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.22)]"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      <div className="activity-scan pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden bg-line" />
      <div className="flex items-start gap-3">
        <div className="thinking-orbit grid h-9 w-9 flex-none place-items-center rounded-full border border-line bg-bg-soft text-accent">
          <Icon name={activityIcon[latest.kind]} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">{latest.label}</p>
            {latest.kind !== "result" && latest.kind !== "error" && (
              <span className="thinking-dots flex flex-none gap-1" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
          {latest.detail && <p className="mt-0.5 truncate text-xs text-ink-muted">{latest.detail}</p>}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {visible.map((item, index) => {
          const isLatest = index === visible.length - 1;
          return (
          <div
            key={item.id}
            className={`activity-row flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
              isLatest ? "bg-surface-2 text-ink-dim" : "text-ink-muted"
            }`}
          >
            <span
              className={`grid h-5 w-5 flex-none place-items-center rounded-full border ${
                item.kind === "error"
                  ? "border-danger/50 text-danger"
                  : item.kind === "result"
                    ? "border-ok/50 text-ok"
                    : isLatest
                      ? "border-accent/60 text-accent"
                      : "border-line-strong text-ink-muted"
              }`}
            >
              <Icon name={activityIcon[item.kind]} className="h-3 w-3" />
            </span>
            <span className="min-w-0 truncate">{item.label}</span>
            {item.detail && <span className="min-w-0 truncate text-ink-muted">{item.detail}</span>}
          </div>
        )})}
      </div>
    </div>
  );
}
