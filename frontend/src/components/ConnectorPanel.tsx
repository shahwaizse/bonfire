import { useEffect, useState } from 'react';
import ToolServiceGroup from './ToolServiceGroup';
import FilesystemSettings from './FilesystemSettings';
import { ExternalLink, Loader2, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { connectorAction, fetchConnectors, type RemoteConnector } from '@/lib/api';

export default function ConnectorPanel({ onClose, onAssign }: { onClose: () => void; onAssign: () => void }) {
  const [rows, setRows] = useState<RemoteConnector[]>([]);
  const [selected, setSelected] = useState('');
  const [enabled, setEnabled] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [testTool, setTestTool] = useState('');
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState('');
  const [custom, setCustom] = useState({ name: '', url: '', auth: 'none', token: '' });
  const row = rows.find(item => item.id === selected);
  const savedTools = JSON.stringify(row?.allowed_tools || []);
  useEffect(() => { if (!rows.some(item => item.id === selected)) setSelected(rows[0]?.id || ''); }, [rows, selected]);
  useEffect(() => { setEnabled(JSON.parse(savedTools)); setTestTool(''); setResult(''); }, [selected, savedTools]);
  useEffect(() => {
    let alive = true;
    const refresh = () => fetchConnectors().then(value => { if (alive) { setRows(value); setLoadError(''); } }).catch(e => { if (alive) setLoadError(e.message); });
    void refresh(); const timer = setInterval(refresh, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); setRows(await fetchConnectors()); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { setBusy(false); }
  };
  const connect = (id: string) => {
    const popup = rows.find(item => item.id === id)?.auth === 'oauth' ? window.open('about:blank', '_blank') : null;
    if (popup) popup.opener = null;
    void run(async () => {
      try {
        const value = await connectorAction(`/${id}/connect`);
        if (value.authorization_url && popup) popup.location.replace(value.authorization_url); else popup?.close();
      } catch (e) { popup?.close(); throw e; }
    });
  };
  return <Sheet open onOpenChange={open => !open && onClose()}><SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[780px]">
    <SheetHeader className="border-b px-6 py-5"><SheetTitle className="flex items-center gap-2"><Plug className="size-5 text-primary" />Tools & connectors</SheetTitle><p className="text-sm text-muted-foreground">Give your little guys a few more things to poke at.</p></SheetHeader>
    <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-5">
      <FilesystemSettings />
      {(error || loadError) && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">{error || loadError}</p>}
      {rows.length > 0 && <div className="flex flex-wrap gap-2">{rows.map(item => <Button key={item.id} variant={selected === item.id ? 'secondary' : 'outline'} onClick={() => setSelected(item.id)}>{item.name}<span className={`size-1.5 rounded-full ${item.status === 'connected' ? 'bg-emerald-300' : 'bg-muted-foreground'}`} /></Button>)}</div>}
      {row && <section className="rounded-2xl border p-5 space-y-4">
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{row.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{row.status === 'signin' ? 'Waiting for sign-in' : row.status}</span></h3><p className="mt-1 break-all text-xs text-muted-foreground">{row.url}</p></div><Button size="icon" variant="ghost" disabled={busy || row.status === 'connecting'} aria-label={`Remove ${row.name}`} onClick={() => void run(() => connectorAction(`/${row.id}`, 'DELETE'))}><Trash2 className="size-4" /></Button></div>
        {row.error && <p className="text-sm text-destructive">{row.error}</p>}
        <div className="flex flex-wrap gap-2"><Button disabled={busy || row.status === 'connecting'} onClick={() => connect(row.id)}>{busy || row.status === 'connecting' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{row.status === 'connected' ? 'Reconnect' : `Connect ${row.name}`}</Button>{row.authorization_url && <Button asChild variant="outline"><a href={row.authorization_url} target="_blank" rel="noreferrer">Continue sign-in<ExternalLink className="size-4" /></a></Button>}{row.status === 'connected' && <Button variant="ghost" disabled={busy} onClick={() => void run(() => connectorAction(`/${row.id}/disconnect`))}>Disconnect</Button>}</div>
        {row.status === 'connected' && <><div className="border-t pt-4"><h4 className="text-sm font-medium">Available tools</h4><p className="mt-1 mb-3 text-xs text-muted-foreground">Check the service to enable all available tools, or expand it to choose individual tools. Then assign them to a little guy. Tools marked “Changes data” can edit your workspace.</p><ToolServiceGroup key={row.id} name={row.name} selected={enabled} onChange={setEnabled} disabled={busy} tools={row.tools.map(tool => ({ id: tool.name, label: tool.name.replaceAll('-', ' '), description: tool.description, badge: tool.readOnly ? 'Reads data' : 'Changes data', unavailable: tool.unavailable }))} /></div>
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run(() => connectorAction(`/${row.id}/tools`, 'PUT', { tools: enabled }))}>Save enabled tools</Button><Button variant="outline" disabled={busy || !row.allowed_tools.length || savedTools !== JSON.stringify(enabled)} onClick={onAssign}>Assign to a little guy</Button></div>
        {row.allowed_tools.length > 0 && <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm">Try a tool</summary><p className="my-3 text-xs text-muted-foreground">This runs a real request. Editing tools change your workspace.</p><select aria-label="Tool to try" className="w-full rounded-lg border bg-background p-2 text-sm" value={testTool} onChange={e => { setTestTool(e.target.value); setResult(''); }}><option value="">Choose an enabled tool</option>{row.tools.filter(tool => row.allowed_tools.includes(tool.name) && !tool.unavailable).map(tool => <option key={tool.name} value={tool.name}>{tool.name}</option>)}</select>{testTool && <><pre className="my-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(row.tools.find(tool => tool.name === testTool)?.inputSchema, null, 2)}</pre><textarea aria-label="Tool arguments JSON" value={args} onChange={e => setArgs(e.target.value)} className="min-h-24 w-full rounded-lg border bg-background p-3 font-mono text-xs" /><Button className="mt-2" disabled={busy} onClick={() => void run(async () => { const output = await connectorAction(`/${row.id}/call`, 'POST', { tool: testTool, arguments: JSON.parse(args) }); setResult(JSON.stringify(output, null, 2)); })}>Run tool</Button></>}{result && <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-xs">{result}</pre>}</details>}</>}
      </section>}
      <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><h3 className="text-sm font-medium">Add MCP connector</h3><p className="mt-1 text-xs text-muted-foreground">Paste a server URL and choose how to sign in.</p><form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); void run(async () => { const added = await connectorAction('', 'POST', custom); setRows(value => [...value, added]); setSelected(added.id); setCustom({ name: '', url: '', auth: 'none', token: '' }); }); }}><Input required maxLength={80} placeholder="Name (e.g. My Notion)" aria-label="Connector name" value={custom.name} onChange={e => setCustom({ ...custom, name: e.target.value })} /><Input required type="url" placeholder="https://example.com/mcp" aria-label="MCP server URL" value={custom.url} onChange={e => setCustom({ ...custom, url: e.target.value })} /><select aria-label="Authentication" className="w-full rounded-lg border bg-background p-2 text-sm" value={custom.auth} onChange={e => setCustom({ ...custom, auth: e.target.value })}><option value="none">No authentication</option><option value="oauth">Browser sign-in (OAuth)</option><option value="bearer">Bearer token</option></select>{custom.auth === 'bearer' && <Input required type="password" autoComplete="off" placeholder="Bearer token" aria-label="Bearer token" value={custom.token} onChange={e => setCustom({ ...custom, token: e.target.value })} />}<p className="text-xs text-muted-foreground">Streamable HTTP endpoints. Credentials stay on this machine.</p><Button disabled={busy}>Add connector</Button></form></section>
    </div>
  </SheetContent></Sheet>;
}
