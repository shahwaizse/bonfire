import { useEffect, useState } from "react";
import { BadgeCheck, Flame, Globe2, Plus, Save, Server, Square, Trash2, X } from "lucide-react";
import { BACKEND_URL, clearAllChats, fetchFunnelStatus } from "@/lib/api";
import type { FunnelStatus, Preset, PromptMode, Settings } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  llamaOnline: boolean | null;
  settings: Settings | null;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onSetFunnelEnabled: (enabled: boolean) => Promise<void>;
  onShutdown: () => Promise<void>;
  onClearAllChats: () => void;
  presets: Preset[];
  onSavePreset: (id: string, patch: Partial<Preset>) => void;
  onCreatePreset: (input: { name: string; description: string; system_prompt: string }) => void;
  onDeletePreset: (id: string) => void;
}

export default function SettingsPanel({
  open,
  onClose,
  llamaOnline,
  settings,
  onUpdateSettings,
  onSetFunnelEnabled,
  onShutdown,
  onClearAllChats,
  presets,
  onSavePreset,
  onCreatePreset,
  onDeletePreset,
}: SettingsPanelProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        data-testid="settings-panel"
        className="flex h-[min(760px,calc(100vh-28px))] max-w-[1040px] grid-rows-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[1040px]"
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Flame className="size-4 text-primary" />
            Settings
          </DialogTitle>
          <DialogDescription>Prompt routing, guardrails, and local service status.</DialogDescription>
        </DialogHeader>

        {settings ? (
          <Tabs defaultValue="prompt" className="min-h-0 flex-1">
            <div className="border-b px-4 pt-3">
              <TabsList>
                <TabsTrigger value="prompt">Prompt</TabsTrigger>
                <TabsTrigger value="guardrails">Guardrails</TabsTrigger>
                <TabsTrigger value="status">Status</TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <TabsContent value="prompt" className="mt-0">
                <PromptTab
                  settings={settings}
                  onUpdateSettings={onUpdateSettings}
                  presets={presets}
                  onSavePreset={onSavePreset}
                  onCreatePreset={onCreatePreset}
                  onDeletePreset={onDeletePreset}
                />
              </TabsContent>
              <TabsContent value="guardrails" className="mt-0">
                <GuardrailsTab settings={settings} onUpdateSettings={onUpdateSettings} />
              </TabsContent>
              <TabsContent value="status" className="mt-0">
                <StatusTab
                  llamaOnline={llamaOnline}
                  settings={settings}
                  onSetFunnelEnabled={onSetFunnelEnabled}
                  onShutdown={onShutdown}
                  onClearAllChats={onClearAllChats}
                />
              </TabsContent>
            </div>
          </Tabs>
        ) : (
          <div className="p-5 text-sm text-muted-foreground">Loading settings...</div>
        )}
      </DialogContent>
    </Dialog>
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
  const [coreDraft, setCoreDraft] = useState(settings.core_system_prompt);
  const [creating, setCreating] = useState(false);

  useEffect(() => setCustomDraft(settings.custom_prompt), [settings.custom_prompt]);
  useEffect(() => setCoreDraft(settings.core_system_prompt), [settings.core_system_prompt]);

  const modes: { id: PromptMode; label: string }[] = [
    { id: "auto", label: "Auto" },
    { id: "preset", label: "Pinned" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-card/68 p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">Mode</p>
        <div className="inline-flex rounded-xl border bg-background/55 p-1" role="group" aria-label="Prompt mode">
          {modes.map((mode) => (
            <Button
              key={mode.id}
              type="button"
              variant={settings.prompt_mode === mode.id ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={settings.prompt_mode === mode.id}
              onClick={() => onUpdateSettings({ prompt_mode: mode.id })}
            >
              {mode.label}
            </Button>
          ))}
        </div>

        {settings.prompt_mode === "preset" && (
          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Pinned preset</label>
            <Select
              value={settings.active_preset_id}
              onValueChange={(active_preset_id) => onUpdateSettings({ active_preset_id })}
            >
              <SelectTrigger className="w-full bg-background/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {settings.prompt_mode === "custom" && (
          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="custom-prompt">
              Custom behavior layer
            </label>
            <Textarea
              id="custom-prompt"
              value={customDraft}
              onChange={(event) => setCustomDraft(event.target.value)}
              rows={6}
              placeholder="Add behavior instructions..."
            />
            <Button
              type="button"
              onClick={() => onUpdateSettings({ custom_prompt: customDraft })}
              disabled={customDraft === settings.custom_prompt}
              className="mt-2"
              size="sm"
            >
              <Save />
              Save
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card/68 p-4">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="core-system-prompt">
          Core system prompt
        </label>
        <Textarea
          id="core-system-prompt"
          value={coreDraft}
          onChange={(event) => setCoreDraft(event.target.value)}
          rows={8}
          className="font-mono text-xs"
          placeholder="Leave empty to use Bonfire's default core prompt..."
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => onUpdateSettings({ core_system_prompt: coreDraft })}
            disabled={coreDraft === settings.core_system_prompt}
            size="sm"
          >
            <Save />
            Save
          </Button>
          {settings.core_system_prompt && (
            <Button
              type="button"
              onClick={() => {
                setCoreDraft("");
                onUpdateSettings({ core_system_prompt: "" });
              }}
              variant="outline"
              size="sm"
            >
              Reset to default
            </Button>
          )}
        </div>

        <Separator className="my-4" />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="llm-temperature">
              Temperature
            </label>
            <Badge variant="outline">{settings.llm_temperature.toFixed(2)}</Badge>
          </div>
          <Slider
            id="llm-temperature"
            min={0}
            max={2}
            step={0.05}
            value={[settings.llm_temperature]}
            onValueChange={([llm_temperature]) => onUpdateSettings({ llm_temperature })}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">Presets</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating((value) => !value)}>
            {creating ? <X /> : <Plus />}
            {creating ? "Cancel" : "New preset"}
          </Button>
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
      </section>
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
  useEffect(() => setDraft(settings.guardrails), [settings.guardrails]);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Guardrails</span>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={12}
          placeholder="Example: Never reveal private API keys. Ask before destructive filesystem changes."
        />
      </label>
      <Button type="button" onClick={() => onUpdateSettings({ guardrails: draft })} disabled={draft === settings.guardrails}>
        <Save />
        Save guardrails
      </Button>
    </div>
  );
}

function StatusTab({
  llamaOnline,
  settings,
  onSetFunnelEnabled,
  onShutdown,
  onClearAllChats,
}: {
  llamaOnline: boolean | null;
  settings: Settings;
  onSetFunnelEnabled: (enabled: boolean) => Promise<void>;
  onShutdown: () => Promise<void>;
  onClearAllChats: () => void;
}) {
  const [funnelStatus, setFunnelStatus] = useState<FunnelStatus | null>(null);
  const [funnelBusy, setFunnelBusy] = useState(false);
  const [shutdownBusy, setShutdownBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
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
    if (funnelBusy) return;
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

  const clearChats = async () => {
    if (clearBusy) return;
    if (!window.confirm("Delete all conversations and messages? This cannot be undone.")) return;
    setError("");
    setClearBusy(true);
    try {
      await clearAllChats();
      onClearAllChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear chats");
    } finally {
      setClearBusy(false);
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

  const funnelOn = funnelStatus?.active ?? settings.funnel_enabled;

  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <StatusTile title="llama.cpp" value={llamaOnline === null ? "Checking..." : llamaOnline ? "Online" : "Offline"} good={Boolean(llamaOnline)} icon={<Server className="size-4" />} />
      <StatusTile title="Backend" value={BACKEND_URL} good icon={<BadgeCheck className="size-4" />} />

      <section className="rounded-xl border bg-card/68 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Tailscale Funnel</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Saved {settings.funnel_enabled ? "On" : "Off"}
              {funnelStatus && ` / Active ${funnelStatus.active ? "On" : "Off"}`}
            </p>
          </div>
          <Switch checked={funnelOn} onCheckedChange={toggleFunnel} disabled={funnelBusy} aria-label="Tailscale Funnel" />
        </div>
      </section>

      <section className="rounded-xl border bg-card/68 p-4">
        <p className="font-medium">Clear all chats</p>
        <Button type="button" variant="outline" className="mt-3" onClick={clearChats} disabled={clearBusy}>
          <Trash2 />
          {clearBusy ? "Clearing" : "Clear all chats"}
        </Button>
      </section>

      <section className="rounded-xl border border-destructive/30 bg-destructive/8 p-4 sm:col-span-2">
        <p className="font-medium">Shutdown</p>
        <Button type="button" variant="destructive" className="mt-3" onClick={shutdown} disabled={shutdownBusy}>
          <Square />
          {shutdownBusy ? "Shutting down" : "Shut down Bonfire"}
        </Button>
      </section>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive sm:col-span-2">{error}</div>}
    </div>
  );
}

function StatusTile({
  title,
  value,
  good,
  icon,
}: {
  title: string;
  value: string;
  good: boolean;
  icon: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card/68 p-4">
      <div className="flex items-center gap-2">
        <span className={good ? "text-emerald-300" : "text-destructive"}>{icon}</span>
        <p className="font-medium">{title}</p>
      </div>
      <p className={`mt-1 break-all text-xs ${good ? "text-emerald-300" : "text-destructive"}`}>{value}</p>
    </section>
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
  useEffect(() => setPrompt(preset.system_prompt), [preset.system_prompt]);

  return (
    <article className="rounded-xl border bg-card/68">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{preset.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{preset.description}</span>
        </span>
        {preset.is_builtin && <Badge variant="outline">Built in</Badge>}
      </button>

      {expanded && (
        <div className="space-y-3 border-t px-4 py-4">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            aria-label={`${preset.name} system prompt`}
          />
          <div className="flex items-center justify-between gap-3">
            <Button type="button" onClick={() => onSave(preset.id, { system_prompt: prompt })} disabled={prompt === preset.system_prompt} size="sm">
              <Save />
              Save
            </Button>
            {!preset.is_builtin && (
              <Button type="button" onClick={() => onDelete(preset.id)} variant="destructive" size="sm">
                <Trash2 />
                Delete preset
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
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
    <div className="mb-3 space-y-2 rounded-xl border bg-card/68 p-4">
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Preset name" />
      <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short description" aria-label="Preset description" />
      <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} placeholder="System prompt..." aria-label="Preset system prompt" />
      <Button type="button" onClick={() => name.trim() && prompt.trim() && onCreate({ name, description, system_prompt: prompt })} disabled={!name.trim() || !prompt.trim()}>
        <Plus />
        Create
      </Button>
    </div>
  );
}
