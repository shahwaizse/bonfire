import { useEffect, useState } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchFileFolders, saveFileFolder, removeFileFolder } from '@/lib/api';
import type { FileFolder } from '@/lib/types';

export default function FilesystemSettings() {
  const [folders, setFolders] = useState<FileFolder[]>([]);
  const [name, setName] = useState(''), [path, setPath] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let alive = true; fetchFileFolders().then(rows => { if (alive) setFolders(rows); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, []);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); setFolders(await fetchFileFolders()); } catch (e) { setError(e instanceof Error ? e.message : 'Folder request failed'); } finally { setBusy(false); } };
  return <section className="space-y-3 rounded-2xl border p-5">
    <h3 className="flex items-center gap-2 text-sm font-medium"><FolderOpen className="size-4 text-primary" />Local folders</h3>
    <p className="text-xs leading-relaxed text-muted-foreground">Add folders here, then assign read-only or read/write access in a little guy's editor. Adding a folder grants no agent access by itself.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {folders.map(folder => <div key={folder.id} className="flex items-center gap-3 rounded-xl border bg-card/40 p-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{folder.name}</p><p className="mt-1 break-all text-xs text-muted-foreground">{folder.path}</p></div><Button variant="ghost" size="icon" aria-label={`Remove ${folder.name} folder access`} disabled={busy} onClick={() => void run(async () => { await removeFileFolder(folder.id); })}><Trash2 className="size-4" /></Button></div>)}
    <form className="space-y-3 pt-1" onSubmit={e => { e.preventDefault(); void run(async () => { await saveFileFolder({ name, path }); setName(''); setPath(''); }); }}>
      <Input required maxLength={80} placeholder="Folder name (e.g. Projects)" aria-label="Folder name" value={name} onChange={e => setName(e.target.value)} />
      <Input required placeholder="Full folder path, e.g. D:\Projects" aria-label="Full folder path" value={path} onChange={e => setPath(e.target.value)} />
      <Button disabled={busy || !name.trim() || !path.trim()}>Add folder</Button>
    </form>
  </section>;
}
