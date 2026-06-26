import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearMemories,
  createMemory,
  deleteMemory,
  fetchMemories,
  fetchMemoryGraph,
  fetchMemoryStatus,
  rebuildMemoryIndex,
  updateMemory,
} from "@/lib/api";
import type { MemoryGraph, MemoryGraphNode, MemoryItem, MemoryStatus, Settings } from "@/lib/types";
import { Icon } from "./icons";

interface MemoryTabProps {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
}

const kindLabels: Record<MemoryItem["kind"], string> = {
  semantic: "Fact",
  preference: "Preference",
  episodic: "Experience",
  procedural: "Instruction",
};

export default function MemoryTab({ settings, onUpdateSettings }: MemoryTabProps) {
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [graph, setGraph] = useState<MemoryGraph>({ nodes: [], edges: [] });
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<MemoryItem["kind"]>("semantic");
  const [busy, setBusy] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextMemories, nextStatus, nextGraph] = await Promise.all([
      fetchMemories({ query, includeArchived }),
      fetchMemoryStatus(),
      fetchMemoryGraph(),
    ]);
    setMemories(nextMemories);
    setStatus(nextStatus);
    setGraph(nextGraph);
  }, [includeArchived, query]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const handleCreate = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      await createMemory({ text, kind: draftKind, confidence: 0.9, pinned: true });
      setDraft("");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm("Delete every saved memory?")) return;
    setBusy(true);
    try {
      await clearMemories();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleRebuild = async () => {
    setBusy(true);
    try {
      setStatus(await rebuildMemoryIndex());
      setGraph(await fetchMemoryGraph());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.04fr)_minmax(320px,0.96fr)]">
      <section className="min-w-0 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <ToggleRow
            label="Use memory"
            checked={settings.memory_enabled}
            onChange={(memory_enabled) => onUpdateSettings({ memory_enabled })}
          />
          <ToggleRow
            label="Learn automatically"
            checked={settings.memory_auto_extract}
            onChange={(memory_auto_extract) => onUpdateSettings({ memory_auto_extract })}
          />
        </div>

        <div className="rounded-lg border border-line bg-bg-soft p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-xs font-medium text-ink-muted">Search memories</span>
              <div className="flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-2.5">
                <Icon name="search" className="h-3.5 w-3.5 flex-none text-ink-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, preference, project, tool..."
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
                />
              </div>
            </label>
            <label className="flex h-10 items-center gap-2 self-end rounded-md border border-line bg-surface px-3 text-xs text-ink-dim">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              Archived
            </label>
            <button
              type="button"
              onClick={() => refresh().catch(() => {})}
              className="grid h-10 w-10 place-items-center self-end rounded-md border border-line text-ink-dim transition hover:border-line-strong hover:text-ink"
              title="Refresh memories"
              aria-label="Refresh memories"
            >
              <Icon name="refresh" className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_142px_96px]">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              placeholder="Add a memory manually..."
              className="min-h-[56px] resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-muted"
            />
            <select
              value={draftKind}
              onChange={(event) => setDraftKind(event.target.value as MemoryItem["kind"])}
              className="h-10 rounded-md border border-line bg-surface px-2.5 text-xs text-ink outline-none"
              aria-label="Memory kind"
            >
              {Object.entries(kindLabels).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!draft.trim() || busy}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface-3 px-3 text-xs font-medium text-ink transition hover:border-accent hover:bg-[#2b3038] disabled:opacity-40"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap gap-2 text-xs">
            <StatusPill label="Active" value={status?.active ?? memories.filter((item) => !item.archived).length} />
            <StatusPill label="Archived" value={status?.archived ?? 0} />
            <span
              className={`inline-flex h-7 items-center rounded-md border px-2 ${
                status?.chroma_available
                  ? "border-ok/35 bg-ok/10 text-ok"
                  : "border-danger/35 bg-danger/10 text-danger"
              }`}
            >
              Chroma {status?.chroma_available ? "ready" : "offline"}
            </span>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={handleRebuild}
              disabled={busy}
              className="grid h-8 w-8 place-items-center rounded-md border border-line text-ink-dim transition hover:border-line-strong hover:text-ink disabled:opacity-40"
              title="Rebuild Chroma index"
              aria-label="Rebuild Chroma index"
            >
              <Icon name="refresh" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={busy || memories.length === 0}
              className="grid h-8 w-8 place-items-center rounded-md border border-line text-danger transition hover:border-danger disabled:opacity-40"
              title="Delete all memories"
              aria-label="Delete all memories"
            >
              <Icon name="trash" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {memories.length === 0 ? (
            <div className="rounded-lg border border-line bg-bg-soft px-3 py-8 text-center text-sm text-ink-muted">
              No memories yet.
            </div>
          ) : (
            memories.map((item) => (
              <MemoryCard
                key={item.id}
                memory={item}
                onChange={async (patch) => {
                  await updateMemory(item.id, patch);
                  await refresh();
                }}
                onDelete={async () => {
                  await deleteMemory(item.id);
                  await refresh();
                }}
              />
            ))
          )}
        </div>
      </section>

      <section className="min-w-0 rounded-lg border border-line bg-bg-soft p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface text-accent">
              <Icon name="network" className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">Knowledge graph</p>
              <p className="text-xs text-ink-muted">{graph.nodes.length} nodes, {graph.edges.length} links</p>
            </div>
          </div>
        </div>
        <MemoryGraphView graph={graph} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
        <SelectedNode node={graph.nodes.find((node) => node.id === selectedNode) ?? null} />
      </section>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-12 items-center justify-between gap-3 rounded-lg border border-line bg-bg-soft px-3">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span
        className={`relative h-6 w-11 rounded-full border transition ${
          checked ? "border-accent bg-accent/25" : "border-line-strong bg-surface"
        }`}
      >
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-ink transition ${
            checked ? "left-[22px] bg-accent" : "left-1 bg-ink-muted"
          }`}
        />
      </span>
    </label>
  );
}

function StatusPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-bg-soft px-2 text-ink-dim">
      <span>{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </span>
  );
}

function MemoryCard({
  memory,
  onChange,
  onDelete,
}: {
  memory: MemoryItem;
  onChange: (patch: Partial<MemoryItem>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.text);
  const [kind, setKind] = useState<MemoryItem["kind"]>(memory.kind);
  const [topics, setTopics] = useState(memory.topics.join(", "));
  const [entities, setEntities] = useState(memory.entities.join(", "));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(memory.text);
    setKind(memory.kind);
    setTopics(memory.topics.join(", "));
    setEntities(memory.entities.join(", "));
  }, [memory]);

  const save = async () => {
    setBusy(true);
    try {
      await onChange({
        text,
        kind,
        topics: splitTags(topics),
        entities: splitTags(entities),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`rounded-lg border bg-bg-soft ${memory.archived ? "border-line opacity-70" : "border-line"}`}>
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="grid h-8 w-8 flex-none place-items-center rounded-md border border-line bg-surface text-accent">
          <Icon name={memory.pinned ? "pin" : "brain"} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none"
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as MemoryItem["kind"])}
                  className="h-9 rounded-md border border-line bg-surface px-2 text-xs outline-none"
                >
                  {Object.entries(kindLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  value={topics}
                  onChange={(event) => setTopics(event.target.value)}
                  placeholder="topics"
                  className="h-9 rounded-md border border-line bg-surface px-2 text-xs outline-none placeholder:text-ink-muted"
                />
                <input
                  value={entities}
                  onChange={(event) => setEntities(event.target.value)}
                  placeholder="entities"
                  className="h-9 rounded-md border border-line bg-surface px-2 text-xs outline-none placeholder:text-ink-muted"
                />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-ink">{memory.text}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-muted">
                <span className="rounded-md border border-line bg-surface px-1.5 py-0.5">{kindLabels[memory.kind]}</span>
                <span className="rounded-md border border-line bg-surface px-1.5 py-0.5">
                  {Math.round(memory.confidence * 100)}%
                </span>
                {memory.topics.slice(0, 4).map((topic) => (
                  <span key={topic} className="rounded-md border border-line bg-surface px-1.5 py-0.5">
                    {topic}
                  </span>
                ))}
                {memory.entities.slice(0, 3).map((entity) => (
                  <span key={entity} className="rounded-md border border-line bg-surface px-1.5 py-0.5">
                    {entity}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <span className="truncate text-[11px] text-ink-muted">
          Used {memory.use_count} times · {new Date(memory.updated_at).toLocaleDateString()}
        </span>
        <div className="flex flex-none gap-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-dim transition hover:bg-surface hover:text-ink"
                title="Cancel"
                aria-label="Cancel"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy || !text.trim()}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-dim transition hover:bg-surface hover:text-ink disabled:opacity-40"
                title="Save memory"
                aria-label="Save memory"
              >
                <Icon name="archive" className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onChange({ pinned: !memory.pinned })}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-dim transition hover:bg-surface hover:text-ink"
                title={memory.pinned ? "Unpin memory" : "Pin memory"}
                aria-label={memory.pinned ? "Unpin memory" : "Pin memory"}
              >
                <Icon name="pin" className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-dim transition hover:bg-surface hover:text-ink"
                title="Edit memory"
                aria-label="Edit memory"
              >
                <Icon name="edit" className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onChange({ archived: !memory.archived })}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-dim transition hover:bg-surface hover:text-ink"
                title={memory.archived ? "Restore memory" : "Archive memory"}
                aria-label={memory.archived ? "Restore memory" : "Archive memory"}
              >
                <Icon name="archive" className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="grid h-8 w-8 place-items-center rounded-md text-danger transition hover:bg-danger/10"
                title="Delete memory"
                aria-label="Delete memory"
              >
                <Icon name="trash" className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function splitTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function MemoryGraphView({
  graph,
  selectedNode,
  onSelectNode,
}: {
  graph: MemoryGraph;
  selectedNode: string | null;
  onSelectNode: (id: string) => void;
}) {
  const layout = useMemo(() => graphLayout(graph.nodes), [graph.nodes]);

  if (graph.nodes.length === 0) {
    return (
      <div className="grid aspect-[1.35] place-items-center rounded-md border border-line bg-surface text-sm text-ink-muted">
        Empty graph
      </div>
    );
  }

  return (
    <svg viewBox="0 0 640 420" className="aspect-[1.52] w-full rounded-md border border-line bg-surface">
      <defs>
        <radialGradient id="nodeGlow">
          <stop offset="0%" stopColor="rgba(143,182,255,0.55)" />
          <stop offset="100%" stopColor="rgba(143,182,255,0)" />
        </radialGradient>
      </defs>
      {graph.edges.map((edge, index) => {
        const source = layout.get(edge.source);
        const target = layout.get(edge.target);
        if (!source || !target) return null;
        const active = selectedNode === edge.source || selectedNode === edge.target;
        return (
          <line
            key={`${edge.source}-${edge.target}-${index}`}
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
            stroke={active ? "rgba(143,182,255,0.72)" : "rgba(255,255,255,0.13)"}
            strokeWidth={active ? 1.6 : Math.max(0.55, edge.weight * 2)}
          />
        );
      })}
      {graph.nodes.map((node) => {
        const point = layout.get(node.id);
        if (!point) return null;
        const selected = selectedNode === node.id;
        const radius = nodeRadius(node);
        return (
          <g
            key={node.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectNode(node.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelectNode(node.id);
            }}
            className="cursor-pointer"
          >
            {selected && <circle cx={point.x} cy={point.y} r={radius + 13} fill="url(#nodeGlow)" />}
            <circle
              cx={point.x}
              cy={point.y}
              r={radius}
              fill={nodeColor(node.type)}
              stroke={selected ? "#f0f2f5" : "rgba(255,255,255,0.36)"}
              strokeWidth={selected ? 2 : 1}
            />
            {(selected || node.type === "user" || node.weight > 0.62) && (
              <text
                x={point.x}
                y={point.y + radius + 13}
                textAnchor="middle"
                fill="rgba(240,242,245,0.88)"
                fontSize="10"
              >
                {shortLabel(node.label, selected ? 26 : 16)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function graphLayout(nodes: MemoryGraphNode[]) {
  const center = { x: 320, y: 206 };
  const groups = {
    user: nodes.filter((node) => node.type === "user"),
    kind: nodes.filter((node) => node.type === "kind"),
    topic: nodes.filter((node) => node.type === "topic"),
    entity: nodes.filter((node) => node.type === "entity"),
    memory: nodes.filter((node) => !["user", "kind", "topic", "entity"].includes(node.type)),
  };
  const positions = new Map<string, { x: number; y: number }>();
  positions.set("user", center);
  placeRing(groups.kind, 78, -Math.PI / 2, positions);
  placeRing([...groups.topic, ...groups.entity], 145, -Math.PI / 5, positions);
  placeRing(groups.memory, 190, Math.PI / 7, positions);
  return positions;
}

function placeRing(nodes: MemoryGraphNode[], radius: number, offset: number, positions: Map<string, { x: number; y: number }>) {
  const center = { x: 320, y: 206 };
  nodes.forEach((node, index) => {
    const jitter = ((stableHash(node.id) % 19) - 9) * 0.006;
    const angle = offset + (index / Math.max(nodes.length, 1)) * Math.PI * 2 + jitter;
    positions.set(node.id, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius * 0.74,
    });
  });
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nodeRadius(node: MemoryGraphNode) {
  const base = node.type === "user" ? 16 : node.type === "kind" ? 10 : 8;
  return base + Math.min(8, node.weight * 7);
}

function nodeColor(type: string) {
  if (type === "user") return "#8fb6ff";
  if (type === "preference") return "#8be6c2";
  if (type === "procedural") return "#d7b46a";
  if (type === "episodic") return "#c9a3ff";
  if (type === "topic") return "#3a4250";
  if (type === "entity") return "#49d19a";
  if (type === "kind") return "#697383";
  return "#a5adba";
}

function shortLabel(label: string, length: number) {
  return label.length > length ? `${label.slice(0, length - 1)}...` : label;
}

function SelectedNode({ node }: { node: MemoryGraphNode | null }) {
  return (
    <div className="mt-3 min-h-[58px] rounded-md border border-line bg-surface px-3 py-2">
      {node ? (
        <>
          <p className="truncate text-sm font-medium text-ink">{node.label}</p>
          <p className="mt-1 text-xs capitalize text-ink-muted">{node.type.replace("memory:", "")}</p>
        </>
      ) : (
        <div className="flex h-[40px] items-center text-sm text-ink-muted">Select a node</div>
      )}
    </div>
  );
}
