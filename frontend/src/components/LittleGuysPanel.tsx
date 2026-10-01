import { useEffect, useRef, useState } from 'react';
import { Plus, Sparkles, Trash2, Pencil, ArrowRight, LoaderCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fetchApps, fetchTools, fetchConnectors, fetchFileFolders, generateLittleGuy, removeApp, removeLittleGuy, saveApp, saveLittleGuy } from '@/lib/api';
import type { DesktopApp, LittleGuy, LittleGuyProfile, MascotRecipe, ToolCatalog, FileFolder } from '@/lib/types';
import ToolServiceGroup, { type ServiceTool } from './ToolServiceGroup';
import LittleGuyMascot, { defaultMascot } from './LittleGuyMascot';

const fieldClass = 'h-9 w-full rounded-lg border bg-card px-2 text-sm';
const newProfile = (): LittleGuyProfile => ({ name: '', tagline: '', instructions: '', allowed_tools: ['search_web', 'read_webpage'], allowed_apps: [], folder_access: [], mascot: { ...defaultMascot } });
const recipeOptions = {
  body: ['gpu', 'flame', 'blob', 'star', 'robot'], eyes: ['round', 'sleepy', 'sparkle', 'visor'],
  mouth: ['smile', 'grin', 'tiny', 'surprised'], accessory: ['none', 'antenna', 'headphones', 'sprout', 'bolt'],
  pattern: ['plain', 'spots', 'stripes', 'freckles'], palette: ['lavender', 'amethyst', 'moonlight', 'teal', 'rose'],
};
export default function LittleGuysPanel({ open, onOpenChange, guys, onSaved, onChoose, chatBusy, startInCreator = false, initialGuy }: {
  open: boolean; onOpenChange: (open: boolean) => void; guys: LittleGuy[];
  onSaved: () => Promise<void>; onChoose: (id: string) => void; chatBusy: boolean;
  startInCreator?: boolean; initialGuy?: LittleGuy;
}) {
  const [tab, setTab] = useState<'guys' | 'apps'>('guys');
  const [draft, setDraft] = useState<LittleGuyProfile | null>(() => initialGuy ? { name: initialGuy.name, tagline: initialGuy.tagline, instructions: initialGuy.instructions, allowed_tools: [...initialGuy.allowed_tools], allowed_apps: [...initialGuy.allowed_apps], folder_access: [...(initialGuy.folder_access || [])], mascot: { ...initialGuy.mascot } } : startInCreator ? newProfile() : null);
  const [editing, setEditing] = useState<string | undefined>(initialGuy?.id);
  const [brief, setBrief] = useState(initialGuy ? `${initialGuy.name}: ${initialGuy.tagline}` : '');
  const [body, setBody] = useState('surprise'), [palette, setPalette] = useState('surprise'), [vibe, setVibe] = useState('playful');
  const [tools, setTools] = useState<ToolCatalog['tools']>([]), [apps, setApps] = useState<DesktopApp[]>([]);
  const [folders, setFolders] = useState<FileFolder[]>([]);
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [appName, setAppName] = useState(''), [appKind, setAppKind] = useState<'executable' | 'steam'>('steam'), [appTarget, setAppTarget] = useState('');
  const generation = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) { generation.current?.abort(); return; }
    let ignore = false;
    Promise.all([fetchTools(), fetchApps(), fetchConnectors().catch(() => []), fetchFileFolders()]).then(([catalog, available, connectors, configuredFolders]) => { if (!ignore) { setTools(catalog.tools); setApps(available); setFolders(configuredFolders); setServiceNames(Object.fromEntries(connectors.map(connector => [connector.id, connector.name]))); setError(''); } }).catch(e => !ignore && setError(e.message));
    return () => { ignore = true; };
  }, [open]);
  useEffect(() => () => generation.current?.abort(), []);
  const startNew = () => { setDraft(newProfile()); setEditing(undefined); setError(''); setTab('guys'); };
  const create = async () => {
    const controller = new AbortController(); generation.current = controller;
    setBusy(true); setError('');
    try {
      const generated = await generateLittleGuy({ brief, body, palette, vibe }, controller.signal);
      setDraft(previous => previous?.name.trim() ? { ...previous, mascot: generated.mascot } : { ...generated, allowed_tools: previous?.allowed_tools || [], allowed_apps: previous?.allowed_apps || [], folder_access: previous?.folder_access || [] });
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (generation.current === controller) { generation.current = null; setBusy(false); } }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try { await saveLittleGuy(draft, editing); await onSaved(); setDraft(null); setEditing(undefined); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const toolGroups = new Map<string, { name: string; tools: ServiceTool[] }>();
  for (const tool of tools) {
    if (['search_web', 'read_webpage'].includes(tool.function.name)) continue;
    const [service, ...parts] = tool.function.name.split('__');
    const id = parts.length ? service : 'bonfire-web';
    const builtins: Record<string, string> = { desktop: 'App launchers', machine: 'Machine watcher', workspace: 'Shared workspace', files: 'Local files', 'bonfire-web': 'Web & pictures' };
    if (!toolGroups.has(id)) toolGroups.set(id, { name: serviceNames[id] || builtins[id] || id.replaceAll('-', ' ').replaceAll('_', ' '), tools: [] });
    toolGroups.get(id)!.tools.push({ id: tool.function.name, label: (parts.length ? parts.join('__') : service).replaceAll('_', ' ').replaceAll('-', ' '), description: tool.function.name === 'desktop__launch_app' ? 'Opens assigned apps when requested, without a second confirmation.' : tool.function.description });
  }
  const addApp = async () => {
    setBusy(true); setError('');
    try { await saveApp({ name: appName, kind: appKind, target: appTarget.trim() }); setApps(await fetchApps()); setAppName(''); setAppTarget(''); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:w-[820px] data-[side=right]:sm:max-w-[92vw]">
      <SheetHeader className="border-b pb-4">
        <SheetTitle className="text-xl">Meet your little guys</SheetTitle>
        <p className="text-sm text-muted-foreground">Small characters. Specific jobs. Real tools.</p>
      </SheetHeader>
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={tab === 'guys' ? 'secondary' : 'ghost'} onClick={() => setTab('guys')}>Your crew</Button>
          <Button variant={tab === 'apps' ? 'secondary' : 'ghost'} onClick={() => setTab('apps')}>App launchers</Button>
          {tab === 'guys' && <Button className="ml-auto" onClick={startNew} disabled={busy}><Plus />New little guy</Button>}
        </div>
        {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}
        {tab === 'guys' && !draft && <>
          {!guys.length && <div className="flex flex-col items-center rounded-2xl border bg-card/50 p-8 text-center"><LittleGuyMascot size={150} /><h2 className="mt-4 font-semibold">Your crew starts with one little guy.</h2><p className="mt-2 max-w-sm text-sm text-muted-foreground">Describe a job, let the local model design a character, then choose the tools it may use.</p><Button className="mt-5" onClick={startNew}>Make your first guy</Button></div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{guys.map(guy => <article key={guy.id} className="rounded-2xl border bg-card/70 p-4">
            <div className="flex items-center gap-3"><LittleGuyMascot recipe={guy.mascot} size={95} label={guy.name} /><div className="min-w-0"><h2 className="truncate font-semibold">{guy.name}</h2><p className="mt-1 text-sm text-muted-foreground">{guy.tagline}</p><p className="mt-2 text-xs text-muted-foreground">{guy.allowed_tools.length} tools / {guy.allowed_apps.length} apps</p></div></div>
            <div className="mt-4 flex gap-2"><Button className="flex-1" disabled={chatBusy || busy} onClick={() => { onChoose(guy.id); onOpenChange(false); }}>Chat<ArrowRight /></Button><Button variant="outline" size="icon" aria-label={`Edit ${guy.name}`} disabled={busy} onClick={() => { const { id, created_at: _created, updated_at: _updated, ...profile } = guy; setDraft(profile); setEditing(id); setBrief(`${guy.name}: ${guy.tagline}`.slice(0, 1200)); }}><Pencil /></Button><Button variant="ghost" size="icon" aria-label={`Delete ${guy.name}`} disabled={busy} onClick={async () => { if (!window.confirm(`Delete ${guy.name}? Its old chats remain readable, but cannot continue.`)) return; try { await removeLittleGuy(guy.id); await onSaved(); } catch (e) { setError((e as Error).message); } }}><Trash2 /></Button></div>
          </article>)}</div>
        </>}
        {tab === 'guys' && draft && <div className="space-y-5">
          <section className="rounded-2xl border bg-card/50 p-4">
            <div className="flex flex-col items-center gap-3 sm:flex-row"><LittleGuyMascot recipe={draft.mascot} size={150} label={draft.name || 'New little guy'} /><div className="w-full space-y-2"><label className="block text-sm font-medium" htmlFor="guy-brief">What is this guy here for?</label><Textarea id="guy-brief" maxLength={1200} value={brief} onChange={e => setBrief(e.target.value)} placeholder="A sleepy GPU gremlin who opens Tekken and keeps replies short." />
              <div className="grid grid-cols-3 gap-2">{[['Shape', body, setBody, recipeOptions.body], ['Colors', palette, setPalette, recipeOptions.palette], ['Vibe', vibe, setVibe, ['playful', 'calm', 'focused', 'chaotic']]].map(([label, value, setter, options]) => <label key={String(label)} className="text-xs text-muted-foreground">{String(label)}<select aria-label={String(label)} className={`${fieldClass} mt-1`} value={String(value)} onChange={e => (setter as (v: string) => void)(e.target.value)}>{label !== 'Vibe' && <option value="surprise">Surprise me</option>}{(options as string[]).map(option => <option key={option} value={option}>{option}</option>)}</select></label>)}</div>
              <Button onClick={create} disabled={busy || chatBusy || brief.trim().length < 2} className="w-full">{busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}{busy ? 'Working...' : draft.name.trim() ? 'Remix mascot' : 'Let the model make a guy'}</Button>
            </div></div>
            <details className="mt-3 text-sm text-muted-foreground"><summary className="cursor-pointer">Tweak the mascot</summary><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(recipeOptions).map(([key, options]) => <label key={key} className="text-xs capitalize">{key}<select aria-label={`Mascot ${key}`} className={`${fieldClass} mt-1`} value={draft.mascot[key as keyof MascotRecipe]} onChange={e => setDraft({ ...draft, mascot: { ...draft.mascot, [key]: e.target.value } })}>{options.map(option => <option key={option}>{option}</option>)}</select></label>)}</div></details>
          </section>
          <section className="space-y-3"><label className="block space-y-1 text-sm">Name<Input maxLength={48} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label className="block space-y-1 text-sm">One-line personality<Input maxLength={140} value={draft.tagline} onChange={e => setDraft({ ...draft, tagline: e.target.value })} /></label><label className="block space-y-1 text-sm">Instructions<Textarea className="min-h-32" maxLength={5000} value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} placeholder="Be concise. Launch an assigned app only when I ask. Never claim a launch succeeded without tool evidence." /></label></section>
          <section className="space-y-3"><h3 className="font-medium">Tools this guy can use</h3><p className="text-xs text-muted-foreground">Web search and page reading are included for every little guy. Check a service to assign its enabled tools, or expand it to choose individual tools.</p><div key={editing || 'new'} className="space-y-2">{[...toolGroups].map(([id, group]) => <ToolServiceGroup key={id} name={group.name} tools={group.tools} selected={draft.allowed_tools} disabled={busy} onChange={allowed_tools => setDraft(previous => previous && ({ ...previous, allowed_tools: [...new Set([...allowed_tools, 'search_web', 'read_webpage'])] }))} />)}</div></section>
          {draft.allowed_tools.some(name => name.startsWith('files__')) && <section className="space-y-3 rounded-xl border p-4"><h3 className="font-medium">Assigned folders</h3><p className="text-xs text-muted-foreground">Choose where this guy can work. Read/write allows changes without another confirmation; previous file contents are backed up automatically.</p>{draft.allowed_tools.includes('files__run_command') && <p className="text-xs leading-relaxed text-muted-foreground">Bash commands run as your Windows account. Assigned writable folders set their working directory; commands can access files beyond those folders. Shell changes do not receive automatic file backups.</p>}{!folders.length && <p className="text-sm text-muted-foreground">Add a folder in Tools & connectors first.</p>}{folders.map(folder => {
            const access = draft.folder_access?.find(item => item.folder_id === folder.id);
            return <div key={folder.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><label className="flex min-w-0 flex-1 items-center gap-3"><input type="checkbox" className="accent-primary" checked={Boolean(access)} disabled={busy} onChange={e => setDraft(previous => previous && ({ ...previous, folder_access: e.target.checked ? [...(previous.folder_access || []), { folder_id: folder.id, mode: 'read' }] : (previous.folder_access || []).filter(item => item.folder_id !== folder.id) }))} /><span className="min-w-0"><span className="block text-sm font-medium">{folder.name}</span><span className="mt-1 block break-all text-xs text-muted-foreground">{folder.path}</span></span></label>{access && <select aria-label={`${folder.name} access`} disabled={busy} className={`${fieldClass} w-auto!`} value={access.mode} onChange={e => setDraft(previous => previous && ({ ...previous, folder_access: (previous.folder_access || []).map(item => item.folder_id === folder.id ? { ...item, mode: e.target.value as 'read' | 'write' } : item) }))}><option value="read">Read only</option><option value="write">Read & write</option></select>}</div>;
          })}</section>}
          {draft.allowed_tools.some(name => name.startsWith('desktop__')) && <section className="rounded-xl border p-4"><h3 className="mb-2 font-medium">Assigned apps</h3>{apps.map(app => <label key={app.id} className="flex items-center gap-2 py-1.5 text-sm"><input type="checkbox" className="accent-primary" checked={draft.allowed_apps.includes(app.id)} onChange={e => setDraft({ ...draft, allowed_apps: e.target.checked ? [...draft.allowed_apps, app.id] : draft.allowed_apps.filter(id => id !== app.id) })} />{app.name}</label>)}<p className="mt-3 text-xs text-muted-foreground">Add Tekken or another app in App launchers. No paths or commands come from the model.</p></section>}
          <div className="flex gap-2"><Button onClick={save} disabled={busy || !draft.name.trim()}>Save little guy</Button><Button variant="ghost" disabled={busy} onClick={() => { setDraft(null); setEditing(undefined); }}>Cancel</Button></div>
        </div>}
        {tab === 'apps' && <div className="space-y-5"><p className="text-sm text-muted-foreground">Configure apps here, then assign them to a guy. Launching happens only when requested in chat; setting up an app does not open it.</p><div className="space-y-2">{apps.map(app => <div key={app.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card/50 p-3"><div className="min-w-0"><p className="font-medium">{app.name}</p><p className="truncate text-xs text-muted-foreground" title={app.target}>{app.kind === 'steam' ? `Steam app ${app.target}` : app.target}</p></div><Button variant="ghost" size="icon" aria-label={`Remove ${app.name}`} disabled={busy} onClick={async () => { try { await removeApp(app.id); setApps(await fetchApps()); await onSaved(); setDraft(previous => { if (!previous) return null; const allowed_apps = previous.allowed_apps.filter(id => id !== app.id); return { ...previous, allowed_apps, allowed_tools: allowed_apps.length ? previous.allowed_tools : previous.allowed_tools.filter(name => name !== 'desktop__launch_app') }; }); } catch (e) { setError((e as Error).message); } }}><Trash2 /></Button></div>)}</div><section className="space-y-3 rounded-2xl border p-4"><h3 className="font-medium">Add an app</h3><label className="block text-sm">Name<Input value={appName} onChange={e => setAppName(e.target.value)} maxLength={64} placeholder="Tekken" /></label><label className="block text-sm">Launch method<select className={`${fieldClass} mt-1`} value={appKind} onChange={e => setAppKind(e.target.value as 'steam' | 'executable')}><option value="steam">Steam app ID</option><option value="executable">Windows executable</option></select></label><label className="block text-sm">{appKind === 'steam' ? 'Steam app ID' : 'Full executable path'}<Input value={appTarget} onChange={e => setAppTarget(e.target.value)} placeholder={appKind === 'steam' ? 'Paste the game’s Steam app ID' : 'C:\\Windows\\System32\\notepad.exe'} /></label><Button disabled={busy || !appName.trim() || !appTarget.trim()} onClick={addApp}>Add app</Button></section></div>}
      </div>
    </SheetContent>
  </Sheet>;
}
