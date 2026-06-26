import { useEffect, useId, useRef, useState } from "react";
import type { Preset } from "@/lib/types";
import { Icon } from "./icons";

interface ComposerBarProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
  searchEnabled: boolean;
  onSearchEnabledChange: (value: boolean) => void;
  presets: Preset[];
  presetOverride: string | null;
  onPresetOverrideChange: (id: string | null) => void;
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
  presets,
  presetOverride,
  onPresetOverrideChange,
  autoFocus,
}: ComposerBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const activePreset = presets.find((preset) => preset.id === presetOverride);
  const modeLabel = activePreset ? activePreset.name : "Auto";
  const sendDisabled = !isStreaming && (disabled || !value.trim());

  return (
    <div className="mx-auto w-full max-w-[780px] px-3 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-4">
      <div className="rounded-[14px] border border-line bg-surface/95 p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.36)] backdrop-blur transition-colors">
        <div className="flex items-end gap-1.5">
          <textarea
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
            className="max-h-[168px] min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] leading-5 text-ink outline-none placeholder:text-ink-muted"
          />
          <button
            type="button"
            onClick={isStreaming ? onStop : onSend}
            disabled={sendDisabled}
            aria-label={isStreaming ? "Stop generating" : "Send message"}
            title={isStreaming ? "Stop generating" : "Send message"}
            className={`mb-0.5 grid h-10 w-10 flex-none place-items-center rounded-[10px] border transition duration-150 active:scale-[0.97] disabled:opacity-70 disabled:active:scale-100 ${
              isStreaming
                ? "border-danger/35 bg-danger/14 text-danger hover:bg-danger/20"
                : "border-line-strong bg-surface-3 text-ink hover:border-accent hover:bg-[#2b3038]"
            }`}
          >
            <Icon name={isStreaming ? "stop" : "send"} className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2 px-1 pb-0.5">
          <button
            type="button"
            role="switch"
            aria-checked={searchEnabled}
            onClick={() => onSearchEnabledChange(!searchEnabled)}
            className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs transition duration-150 active:scale-[0.98] ${
              searchEnabled
                ? "border-ok/60 bg-ok/15 text-ink shadow-[0_0_0_1px_rgba(73,209,154,0.12)]"
                : "border-line bg-bg-soft text-ink-dim hover:border-line-strong hover:text-ink"
            }`}
          >
            <Icon name="globe" className="h-3.5 w-3.5" />
            <span>Web search</span>
            <span className={`relative h-4 w-7 rounded-full transition ${searchEnabled ? "bg-ok" : "bg-surface-3"}`} aria-hidden="true">
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${searchEnabled ? "left-3.5" : "left-0.5"}`} />
            </span>
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-bg-soft px-3 text-xs text-ink-dim transition duration-150 hover:border-line-strong hover:text-ink active:scale-[0.98]"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-controls={menuId}
            >
              <span className="max-w-[9.5rem] truncate">{modeLabel}</span>
              <Icon name="chevronDown" className="h-3.5 w-3.5" />
            </button>

            {menuOpen && (
              <div
                id={menuId}
                role="listbox"
                aria-label="Response mode"
                className="absolute bottom-full left-0 z-30 mb-2 w-64 animate-surface-in rounded-lg border border-line bg-surface p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.5)]"
              >
                <ModeOption
                  active={!presetOverride}
                  label="Auto"
                  description="Choose per message"
                  onSelect={() => {
                    onPresetOverrideChange(null);
                    setMenuOpen(false);
                  }}
                />
                {presets.map((preset) => (
                  <ModeOption
                    key={preset.id}
                    active={presetOverride === preset.id}
                    label={preset.name}
                    description={preset.description}
                    onSelect={() => {
                      onPresetOverrideChange(preset.id);
                      setMenuOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeOption({
  active,
  label,
  description,
  onSelect,
}: {
  active: boolean;
  label: string;
  description?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
        active ? "bg-surface-3 text-ink" : "text-ink-dim hover:bg-surface-2 hover:text-ink"
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{label}</span>
        {description && <span className="block truncate text-[11px] text-ink-muted">{description}</span>}
      </span>
      {active && <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent-2" aria-hidden="true" />}
    </button>
  );
}
