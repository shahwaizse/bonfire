import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export type ServiceTool = { id: string; label: string; description: string; badge?: string; unavailable?: string };

export default function ToolServiceGroup({ name, tools, selected, onChange, disabled = false }: {
  name: string; tools: ServiceTool[]; selected: string[]; onChange: (selected: string[]) => void; disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const available = tools.filter(tool => !tool.unavailable);
  const count = available.filter(tool => selected.includes(tool.id)).length;
  const all = available.length > 0 && count === available.length;
  const selectAll = () => {
    const ids = new Set(available.map(tool => tool.id));
    onChange(all ? selected.filter(id => !ids.has(id)) : [...new Set([...selected, ...ids])]);
  };
  return <section className="overflow-hidden rounded-xl border bg-card/40" aria-label={`${name} tools`}>
    <div className="flex items-center gap-3 px-3">
      <input type="checkbox" className="size-4 flex-none accent-primary" aria-label={`${all ? 'Deselect' : 'Select'} all ${name} tools`} checked={all} ref={input => { if (input) input.indeterminate = count > 0 && !all; }} disabled={disabled || !available.length} onChange={selectAll} />
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name} tools`}>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{count} of {available.length} selected{tools.length > available.length && ` · ${tools.length - available.length} unavailable`}</span></span>
        <ChevronDown className={`size-4 flex-none text-muted-foreground transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>
    </div>
    {expanded && <div className="space-y-1 border-t p-2">{tools.map(tool => <label key={tool.id} className={`flex items-start gap-3 rounded-lg p-2 ${tool.unavailable ? 'opacity-50' : 'cursor-pointer hover:bg-muted/30'}`}>
      <input type="checkbox" className="mt-1 accent-primary" disabled={disabled || Boolean(tool.unavailable)} checked={selected.includes(tool.id)} onChange={event => onChange(event.target.checked ? [...new Set([...selected, tool.id])] : selected.filter(id => id !== tool.id))} />
      <span className="min-w-0"><span className="text-sm font-medium">{tool.label}</span>{tool.badge && <span className={`ml-2 text-[10px] ${tool.badge === 'Changes data' ? 'text-amber-300' : 'text-muted-foreground'}`}>{tool.badge}</span>}<span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-muted-foreground" title={tool.unavailable || tool.description}>{tool.unavailable || tool.description}</span></span>
    </label>)}</div>}
  </section>;
}
