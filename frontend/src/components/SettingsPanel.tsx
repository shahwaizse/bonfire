import { useEffect, useRef, useState } from "react";
import { BACKEND_URL, fetchFunnelStatus } from "@/lib/api";
import type { FunnelStatus, Preset, PromptMode, Settings } from "@/lib/types";
import { Icon } from "./icons";
import MemoryTab from "./MemoryTab";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  llamaOnline: boolean | null;
  settings: Settings | null;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onSetFunnelEnabled: (enabled: boolean) => Promise<void>;
  onShutdown: () => Promise<void>;
  presets: Preset[];
  onSavePreset: (id: string, patch: Partial<Preset>) => void;
  onCreatePreset: (input: { name: string; description: string; system_prompt: string }) => void;
  onDeletePreset: (id: string) => void;
}

type Tab = "prompt" | "memory" | "guardrails" | "status";

export default function SettingsPanel({
  open,
  onClose,
  llamaOnline,
  settings,
  onUpdateSettings,
  onSetFunnelEnabled,
  onShutdown,
  presets,
  onSavePreset,
  onCreatePreset,
  onDeletePreset,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>("prompt");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/66 p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        data-testid="settings-panel"
        className="animate-modal-in flex h-[min(780px,calc(100vh-32px))] w-full max-w-[1080px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[0_28px_100px_rgba(0,0,0,0.58)] outline-none"
      >
        <div className="flex flex-none items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 id="settings-title" className="text-sm font-semibold text-ink">
              Settings
            </h2>
            <p className="text-xs text-ink-muted">Prompt routing, memory, guardrails, and local service status.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-md text-ink-dim transition hover:bg-surface-2 hover:text-ink"
            aria-label="Close settings"
            title="Close settings"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-none gap-1 border-b border-line px-3 pt-2" role="tablist" aria-label="Settings sections">
          {(["prompt", "memory", "guardrails", "status"] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              aria-controls={`${item}-panel`}
              id={`${item}-tab`}
              onClick={() => setTab(item)}
              className={`rounded-t-md px-3 py-2 text-xs font-medium capitalize transition-colors ${
                tab === item ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink-dim"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {tab === "status" && (
            <section id="status-panel" role="tabpanel" aria-labelledby="status-tab">
              <StatusTab
                llamaOnline={llamaOnline}
                settings={settings}
                onSetFunnelEnabled={onSetFunnelEnabled}
                onShutdown={onShutdown}
              />
            </section>
          )}
          {tab === "prompt" && settings && (
            <section id="prompt-panel" role="tabpanel" aria-labelledby="prompt-tab">
              <PromptTab
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                presets={presets}
                onSavePreset={onSavePreset}
                onCreatePreset={onCreatePreset}
                onDeletePreset={onDeletePreset}
              />
            </section>
          )}
          {tab === "memory" && settings && (
            <section id="memory-panel" role="tabpanel" aria-labelledby="memory-tab">
              <MemoryTab settings={settings} onUpdateSettings={onUpdateSettings} />
            </section>
          )}
          {tab === "guardrails" && settings && (
            <section id="guardrails-panel" role="tabpanel" aria-labelledby="guardrails-tab">
              <GuardrailsTab settings={settings} onUpdateSettings={onUpdateSettings} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusTab({
  llamaOnline,
  settings,
  onSetFunnelEnabled,
  onShutdown,
}: {
  llamaOnline: boolean | null;
  settings: Settings | null;
  onSetFunnelEnabled: (enabled: boolean) => Promise<void>;
  onShutdown: () => Promise<void>;
}) {
  const [funnelStatus, setFunnelStatus] = useState<FunnelStatus | null>(null);
  const [funnelBusy, setFunnelBusy] = useState(false);
  const [shutdownBusy, setShutdownBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshFunnelStatus = async () => {
    try {
      setFunnelStatus(await fetchFunnelStatus());
    } catch {
      setFunnelStatus(null);
    }
  };

  useEffect(() => {
    refreshFunnelStatus();
  }, []);

  const toggleFunnel = async () => {
    if (!settings || funnelBusy) return;
    const enabled = !(funnelStatus?.active ?? settings.funnel_enabled);
    setError("");
    setFunnelBusy(true);
    try {
      await onSetFunnelEnabled(enabled);
      await refreshFunnelStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update Funnel");
    } finally {
      setFunnelBusy(false);
    }
  };

  const shutdown = async () => {
    if (shutdownBusy) return;
    if (!window.confirm("Shut down Bonfire now? This stops the backend, frontend, model server, SearXNG, and active Funnel routes.")) {
      return;
    }
    setError("");
    setShutdownBusy(true);
    try {
      await onShutdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to shut down Bonfire");
      setShutdownBusy(false);
    }
  };

  const funnelSaved = settings?.funnel_enabled ?? false;
  const funnelActual = funnelStatus?.active;
  const funnelOn = funnelActual ?? funnelSaved;

  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="rounded-lg border border-line bg-bg-soft p-3">
        <p className="font-medium text-ink">llama.cpp</p>
        <p className={`mt-1 text-xs ${llamaOnline ? "text-ok" : "text-danger"}`}>
          {llamaOnline === null ? "Checking..." : llamaOnline ? "Online" : "Offline"}
        </p>
      </div>
      <div className="rounded-lg border border-line bg-bg-soft p-3">
        <p className="font-medium text-ink">Backend</p>
        <p className="mt-1 break-all text-xs text-ink-muted">{BACKEND_URL}</p>
      </div>
      <div className="rounded-lg border border-line bg-bg-soft p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-ink">Tailscale Funnel</p>
            <p className={`mt-1 text-xs ${funnelSaved ? "text-ok" : "text-ink-muted"}`}>
              Saved {funnelSaved ? "On" : "Off"}
              {funnelStatus && ` · Active ${funnelActual ? "On" : "Off"}`}
            </p>
            {funnelSaved && (
              <p className="mt-1 break-all text-xs text-ink-muted">https://riebeck.tail4fc8a6.ts.net</p>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={funnelOn}
            onClick={toggleFunnel}
            disabled={!settings || funnelBusy}
            className={`inline-flex h-8 flex-none items-center gap-2 rounded-full border px-3 text-xs transition ${
              funnelOn
                ? "border-ok/60 bg-ok/15 text-ink"
                : "border-line bg-surface text-ink-dim hover:border-line-strong hover:text-ink"
            } disabled:opacity-50`}
          >
            <Icon name="globe" className="h-3.5 w-3.5" />
            {funnelBusy ? "Saving" : funnelOn ? "On" : "Off"}
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-danger/40 bg-danger/8 p-3">
        <p className="font-medium text-ink">Shutdown</p>
        <p className="mt-1 text-xs text-ink-muted">Stops Bonfire services and frees the model server GPU load.</p>
        <button
          type="button"
          onClick={shutdown}
          disabled={shutdownBusy}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-danger/45 bg-danger/14 px-3 text-xs font-medium text-danger transition hover:bg-danger/20 disabled:opacity-50"
        >
          <Icon name="stop" className="h-3.5 w-3.5" />
          {shutdownBusy ? "Shutting down" : "Shut down Bonfire"}
        </button>
      </div>
      {error && (
        <div className="rounded-lg border border-danger/45 bg-danger/12 p-3 text-xs text-danger sm:col-span-2">
          {error}
        </div>
      )}
      <div className="rounded-lg border border-line bg-bg-soft p-3 text-xs leading-relaxed text-ink-muted sm:col-span-2">
        This app runs on your machine. Core behavior, presets, custom instructions, and guardrails are assembled
        locally before each llama.cpp request.
      </div>
    </div>
  );
}

function GuardrailsTab({
  settings,
  onUpdateSettings,
}: {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
}) {
  const [draft, setDraft] = useState(settings.guardrails);

  useEffect(() => {
    setDraft(settings.guardrails);
  }, [settings.guardrails]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-bg-soft p-3 text-xs leading-relaxed text-ink-muted">
        Guardrails are appended after Bonfire's core system prompt and the selected behavior layer. Leave this
        blank for no app-level guardrails, or add any local rules you want enforced across every mode.
      </div>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-muted">Guardrails</span>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={10}
          className="w-full resize-none rounded-lg border border-line bg-bg-soft px-3 py-2 text-sm text-ink outline-none"
          placeholder="Example: Never reveal private API keys. Ask before destructive filesystem changes."
        />
      </label>
      <button
        type="button"
        onClick={() => onUpdateSettings({ guardrails: draft })}
        disabled={draft === settings.guardrails}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface-3 px-3 text-xs font-medium text-ink transition hover:border-accent hover:bg-[#2b3038] disabled:opacity-40"
      >
        <Icon name="archive" className="h-3.5 w-3.5" />
        Save guardrails
      </button>
    </div>
  );
}

function PromptTab({
  settings,
  onUpdateSettings,
  presets,
  onSavePreset,
  onCreatePreset,
  onDeletePreset,
}: {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  presets: Preset[];
  onSavePreset: (id: string, patch: Partial<Preset>) => void;
  onCreatePreset: (input: { name: string; description: string; system_prompt: string }) => void;
  onDeletePreset: (id: string) => void;
}) {
  const [customDraft, setCustomDraft] = useState(settings.custom_prompt);
  const [creating, setCreating] = useState(false);

  const modes: { id: PromptMode; label: string }[] = [
    { id: "auto", label: "Auto" },
    { id: "preset", label: "Pinned" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-line bg-bg-soft p-3">
        <p className="mb-2 text-xs font-medium text-ink-muted">Mode</p>
        <div className="inline-flex rounded-full border border-line bg-surface p-0.5" role="group" aria-label="Prompt mode">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-pressed={settings.prompt_mode === mode.id}
              onClick={() => onUpdateSettings({ prompt_mode: mode.id })}
              className={`h-8 rounded-full px-3 text-xs transition-colors ${
                settings.prompt_mode === mode.id ? "bg-surface-3 text-ink" : "text-ink-dim hover:text-ink"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {settings.prompt_mode === "auto" && "Pick the closest preset for each message."}
          {settings.prompt_mode === "preset" && "Always use one selected preset."}
          {settings.prompt_mode === "custom" && "Layer your custom behavior instructions on top of Bonfire's core prompt."}
        </p>
      </div>

      {settings.prompt_mode === "preset" && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">Pinned preset</span>
          <select
            value={settings.active_preset_id}
            onChange={(event) => onUpdateSettings({ active_preset_id: event.target.value })}
            className="h-10 w-full rounded-lg border border-line bg-bg-soft px-3 text-sm text-ink outline-none"
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {settings.prompt_mode === "custom" && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-muted" htmlFor="custom-prompt">
            Custom behavior layer
          </label>
          <textarea
            id="custom-prompt"
            value={customDraft}
            onChange={(event) => setCustomDraft(event.target.value)}
            rows={6}
            className="w-full resize-none rounded-lg border border-line bg-bg-soft px-3 py-2 text-sm text-ink outline-none"
            placeholder="Add behavior instructions..."
          />
          <button
            type="button"
            onClick={() => onUpdateSettings({ custom_prompt: customDraft })}
            disabled={customDraft === settings.custom_prompt}
            className="mt-2 inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface-3 px-3 text-xs font-medium text-ink transition hover:border-accent hover:bg-[#2b3038] disabled:opacity-40"
          >
            <Icon name="archive" className="h-3.5 w-3.5" />
            Save
          </button>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-ink-muted">Presets</p>
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-line px-3 text-xs text-ink-dim transition hover:border-line-strong hover:text-ink"
          >
            <Icon name={creating ? "x" : "plus"} className="h-3.5 w-3.5" />
            {creating ? "Cancel" : "New preset"}
          </button>
        </div>

        {creating && (
          <NewPresetForm
            onCreate={(input) => {
              onCreatePreset(input);
              setCreating(false);
            }}
          />
        )}

        <div className="space-y-2">
          {presets.map((preset) => (
            <PresetCard key={preset.id} preset={preset} onSave={onSavePreset} onDelete={onDeletePreset} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PresetCard({
  preset,
  onSave,
  onDelete,
}: {
  preset: Preset;
  onSave: (id: string, patch: Partial<Preset>) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState(preset.system_prompt);

  useEffect(() => {
    setPrompt(preset.system_prompt);
  }, [preset.system_prompt]);

  return (
    <div className="rounded-lg border border-line bg-bg-soft">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{preset.name}</span>
          <span className="block truncate text-xs text-ink-muted">{preset.description}</span>
        </span>
        <Icon name="chevronDown" className={`h-4 w-4 flex-none text-ink-muted transition ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-line px-3 py-3">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            aria-label={`${preset.name} system prompt`}
            className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-xs text-ink outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onSave(preset.id, { system_prompt: prompt })}
              disabled={prompt === preset.system_prompt}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface-3 px-3 text-xs font-medium text-ink transition hover:border-accent hover:bg-[#2b3038] disabled:opacity-40"
            >
              <Icon name="archive" className="h-3.5 w-3.5" />
              Save
            </button>
            {!preset.is_builtin && (
              <button type="button" onClick={() => onDelete(preset.id)} className="inline-flex items-center gap-1.5 text-xs text-danger hover:underline">
                <Icon name="trash" className="h-3.5 w-3.5" />
                Delete preset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NewPresetForm({
  onCreate,
}: {
  onCreate: (input: { name: string; description: string; system_prompt: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-line bg-bg-soft p-3">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name"
        aria-label="Preset name"
        className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-xs text-ink outline-none placeholder:text-ink-muted"
      />
      <input
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Short description"
        aria-label="Preset description"
        className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-xs text-ink outline-none placeholder:text-ink-muted"
      />
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={4}
        placeholder="System prompt..."
        aria-label="Preset system prompt"
        className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-xs text-ink outline-none placeholder:text-ink-muted"
      />
      <button
        type="button"
        onClick={() => name.trim() && prompt.trim() && onCreate({ name, description, system_prompt: prompt })}
        disabled={!name.trim() || !prompt.trim()}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface-3 px-3 text-xs font-medium text-ink transition hover:border-accent hover:bg-[#2b3038] disabled:opacity-40"
      >
        <Icon name="plus" className="h-3.5 w-3.5" />
        Create
      </button>
    </div>
  );
}
