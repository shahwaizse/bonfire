import { useEffect, useRef } from "react";
import { Globe, Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ComposerBarProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
  searchEnabled: boolean;
  onSearchEnabledChange: (value: boolean) => void;
  autoFocus?: boolean;
}

export default function ComposerBar({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  isStreaming,
  searchEnabled,
  onSearchEnabledChange,
  autoFocus,
}: ComposerBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendDisabled = !isStreaming && (disabled || !value.trim());

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  return (
    <form
      className="mx-auto w-full max-w-[780px] px-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="overflow-hidden rounded-2xl border bg-card/88 p-2 shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <Textarea
          ref={textareaRef}
          data-composer-input
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask anything..."
          aria-label="Message"
          className="max-h-[168px] min-h-12 resize-none border-0 bg-transparent px-3 py-3 text-[15px] leading-6 shadow-none focus-visible:ring-0"
        />

        <div className="flex items-center justify-between gap-2 border-t px-1 pt-2">
          <div className="flex items-center gap-2">
          <label className="flex h-8 items-center gap-2 rounded-lg border bg-background/60 px-2.5 text-xs text-muted-foreground">
            <Globe className="size-3.5" />
            <span>Web</span>
            <Switch checked={searchEnabled} onCheckedChange={onSearchEnabledChange} aria-label="Web search" />
          </label>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type={isStreaming ? "button" : "submit"}
                onClick={isStreaming ? onStop : undefined}
                disabled={sendDisabled}
                aria-label={isStreaming ? "Stop generating" : "Send message"}
                size="icon-lg"
                className={isStreaming ? "bg-destructive/15 text-destructive hover:bg-destructive/25" : ""}
              >
                {isStreaming ? <Square /> : <Send />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isStreaming ? "Stop generating" : "Send message"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </form>
  );
}
