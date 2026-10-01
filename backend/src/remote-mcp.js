import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ConnectorStore } from './connector-store.js';
import { PORT } from './config.js';

export function connectorUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw Error('Use HTTPS, or HTTP on localhost, without credentials in the URL');
  return url.toString();
}
const notionUrl = 'https://mcp.notion.com/mcp';
const readNames = new Set(['notion-search', 'notion-fetch', 'notion-get-users', 'notion-get-teams', 'notion-get-self', 'notion-get-tool-access']);
function shortName(name) { return /^[\w-]{1,36}$/.test(name) ? name : name.replace(/[^\w-]/g, '_').slice(0, 25) + '_' + createHash('sha256').update(name).digest('hex').slice(0, 10); }

export class RemoteMcpRegistry {
  constructor() { this.store = new ConnectorStore(); this.runtime = new Map(); this.ajv = new Ajv({ strict: false, validateFormats: false }); this.ajv2020 = new Ajv2020({ strict: false, validateFormats: false }); }
  async initialize() {
    this.ready ||= (async () => {
      const rows = await this.store.load();
      for (const row of rows) if (row.enabled && (row.auth !== 'oauth' || row.credentials?.tokens)) void this.connect(row.id).catch(() => {});
    })();
    return this.ready;
  }
  async row(id) { const row = (await this.store.load()).find(item => item.id === id); if (!row) throw Error('Connector not found'); return row; }
  state(id) { if (!this.runtime.has(id)) this.runtime.set(id, { status: 'disconnected', tools: [], epoch: 0 }); return this.runtime.get(id); }
  status() { return (this.store.rows || []).map(row => ({ name: row.id, transport: 'http', connected: this.state(row.id).status === 'connected', tools: this.state(row.id).tools.filter(tool => row.allowed_tools.includes(tool.name) && !tool.unavailable).length })); }
  async list() {
    await this.initialize();
    return (await this.store.load()).map(row => { const current = this.state(row.id); return {
      id: row.id, name: row.name, url: row.url, auth: row.auth, enabled: row.enabled, status: current.status, error: current.error,
      authorization_url: current.authorizationUrl, allowed_tools: row.allowed_tools,
      tools: current.tools.map(({ name, description, inputSchema, readOnly, unavailable }) => ({ name, description, inputSchema, readOnly, unavailable, native_name: `${row.id}__${shortName(name)}` })),
    }; });
  }
  async add(input) {
    await this.initialize();
    const name = String(input.name || '').trim().slice(0, 80);
    if (!name) throw Error('Enter a connector name');
    const { mcpRegistry } = await import('./mcp.js');
    await mcpRegistry.catalog();
    const rows = await this.store.load();
    const usedIds = new Set(['workspace', 'desktop', 'machine', ...rows.map(row => row.id), ...mcpRegistry.status.map(server => server.name)]);
    let base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'connector';
    if (!/^[a-z]/.test(base)) base = `connector-${base}`;
    base = base.slice(0, 24).replace(/-+$/g, '');
    let id = base;
    for (let count = 2; usedIds.has(id); count++) {
      const suffix = `-${count}`;
      id = base.slice(0, 24 - suffix.length).replace(/-+$/g, '') + suffix;
    }
    const auth = input.auth || 'none'; if (!['none', 'bearer', 'oauth'].includes(auth)) throw Error('Unknown authentication method');
    const headers = input.headers || {};
    if (typeof headers !== 'object' || Array.isArray(headers) || Object.entries(headers).some(([key, value]) => !/^[\w-]+$/.test(key) || typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 4000)) throw Error('Headers must be a JSON object of single-line strings');
    if (auth === 'bearer' && (!input.token || /[\r\n]/.test(input.token))) throw Error('Enter a bearer token');
    const row = { id, name, url: connectorUrl(input.url), auth,
      enabled: false, allowed_tools: [], headers: { ...headers, ...(auth === 'bearer' ? { Authorization: `Bearer ${input.token}` } : {}) }, credentials: {} };
    rows.push(row); await this.store.save(); return (await this.list()).find(item => item.id === id);
  }
  provider(row, current, epoch) {
    const credentials = row.credentials ||= {};
    const persist = async () => { if (current.epoch !== epoch) throw Error('Connection attempt was cancelled'); await this.store.save(); };
    return {
      redirectUrl: `http://127.0.0.1:${PORT}/connectors/oauth/callback`,
      clientMetadata: { client_name: 'Bonfire', redirect_uris: [`http://127.0.0.1:${PORT}/connectors/oauth/callback`], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
      state: async () => {
        credentials.pending = { state: randomBytes(32).toString('base64url'), expires: Date.now() + 10 * 60 * 1000 };
        await persist(); return credentials.pending.state;
      },
      clientInformation: () => credentials.client,
      saveClientInformation: async value => { credentials.client = value; await persist(); },
      tokens: () => credentials.tokens,
      saveTokens: async value => { credentials.tokens = value; await persist(); },
      saveCodeVerifier: async value => { credentials.verifier = value; await persist(); },
      codeVerifier: () => { if (!credentials.verifier) throw Error('Sign-in expired; connect again'); return credentials.verifier; },
      redirectToAuthorization: async url => { connectorUrl(url.toString()); current.authorizationUrl = url.toString(); },
      invalidateCredentials: async scope => {
        if (scope === 'all' || scope === 'tokens') delete credentials.tokens;
        if (scope === 'all' || scope === 'client') delete credentials.client;
        if (scope === 'all' || scope === 'verifier') delete credentials.verifier;
        await persist();
      },
    };
  }
  async connect(id, authorizationCode) {
    const row = await this.row(id), current = this.state(id);
    if (current.busy) throw Error('A connection operation is already running');
    current.busy = true; current.status = 'connecting'; current.error = undefined; current.authorizationUrl = undefined;
    const epoch = ++current.epoch;
    await current.client?.close().catch(() => {}); current.client = undefined; current.tools = [];
    const client = new Client({ name: 'bonfire', version: '0.4.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(row.url), {
      ...(row.auth === 'oauth' ? { authProvider: this.provider(row, current, epoch) } : {}),
      requestInit: { headers: row.headers },
      fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(45000)]) }),
    });
    try {
      if (authorizationCode) await transport.finishAuth(authorizationCode);
      await client.connect(transport, { timeout: 45000 });
      const tools = [], cursors = new Set(); let cursor;
      do { const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 45000 }); tools.push(...page.tools); cursor = page.nextCursor;
        if (tools.length > 200 || (cursor && cursors.has(cursor))) throw Error('Connector tool catalog is too large or repeated'); if (cursor) cursors.add(cursor);
      } while (cursor);
      let access;
      if (row.url === notionUrl && tools.some(tool => tool.name === 'notion-get-tool-access')) {
        try { const result = await client.callTool({ name: 'notion-get-tool-access', arguments: {} }, undefined, { timeout: 30000 });
          if (!result.isError) for (const block of result.content || []) if (block.type === 'text') { try { access = JSON.parse(block.text).current_tool_access; } catch {} }
        } catch { /* No account-plan information: paid AI tools remain unavailable. */ }
      }
      const entries = tools.map(tool => {
        const readOnly = tool.annotations?.readOnlyHint === true || (tool.annotations?.readOnlyHint === undefined && row.url === notionUrl && readNames.has(tool.name));
        // Never opt into Notion's paid AI search from this free-only client.
        const accountAccess = access?.[tool.name] || access?.[tool.name.replace(/^notion-/, '').replaceAll('-', '_')];
        const unavailable = row.url === notionUrl && /(?:^|-)ai(?:-|$)/i.test(tool.name) ? 'Notion AI tools are excluded from free-only usage' :
          accountAccess?.status && accountAccess.status !== 'available' ? `Account access: ${accountAccess.status}` : undefined;
        return { ...tool, description: String(tool.description || tool.name).slice(0, 1200), readOnly, unavailable, validate: (tool.inputSchema.$schema?.includes('2020-12') ? this.ajv2020 : this.ajv).compile(tool.inputSchema) };
      });
      if (current.epoch !== epoch) throw Error('Connection attempt was cancelled');
      current.client = client; current.tools = entries; current.status = 'connected'; row.enabled = true;
      delete row.credentials.pending; delete row.credentials.verifier;
      await this.store.save();
      client.onclose = () => { if (current.client === client) { current.status = 'disconnected'; current.tools = []; current.client = undefined; } };
    } catch (error) {
      await client.close().catch(() => {});
      if (current.epoch === epoch) {
        current.client = undefined; current.tools = [];
        current.status = current.authorizationUrl ? 'signin' : 'error';
        current.error = current.authorizationUrl ? undefined : 'Could not connect. Check the endpoint, authentication and account access, then reconnect.';
      }
      if (authorizationCode) throw Error('Sign-in could not be completed. Return to Bonfire and reconnect.');
    } finally { current.busy = false; }
    return (await this.list()).find(item => item.id === id);
  }
  async finish(state, code) {
    if (typeof state !== 'string' || state.length > 128 || typeof code !== 'string' || !code || code.length > 4000) throw Error('Invalid sign-in callback');
    const row = (await this.store.load()).find(item => { const pending = item.credentials?.pending;
      return pending && pending.expires > Date.now() && pending.state.length === state.length && timingSafeEqual(Buffer.from(pending.state), Buffer.from(state)); });
    if (!row) throw Error('Sign-in expired or already used. Connect again in Bonfire.');
    // Consume state before exchanging code; PKCE verifier remains until the exchange ends.
    delete row.credentials.pending; await this.store.save();
    return this.connect(row.id, code);
  }
  async setTools(id, names) {
    const row = await this.row(id), current = this.state(id);
    if (!Array.isArray(names) || names.length > 200 || names.some(name => !current.tools.some(tool => tool.name === name && !tool.unavailable))) throw Error('Choose available tools from this connector');
    row.allowed_tools = [...new Set(names)]; await this.store.save();
    return (await this.list()).find(item => item.id === id);
  }
  async disconnect(id, remove = false) {
    const row = await this.row(id), current = this.state(id);
    if (current.busy) throw Error('Wait for the connection operation to finish');
    current.epoch++; const client = current.client; current.client = undefined; current.tools = []; current.authorizationUrl = undefined; current.error = undefined; current.status = 'disconnected';
    row.enabled = false; row.credentials = {};
    await client?.close().catch(() => {});
    if (remove) this.store.rows = (await this.store.load()).filter(item => item.id !== id);
    await this.store.save();
  }
  async catalog() {
    await this.initialize();
    return (await this.store.load()).flatMap(row => this.state(row.id).status === 'connected' ? this.state(row.id).tools.filter(tool => row.allowed_tools.includes(tool.name) && !tool.unavailable).map(tool => ({ type: 'function', function: { name: `${row.id}__${shortName(tool.name)}`, description: tool.description.slice(0, 1000), parameters: tool.inputSchema } })) : []);
  }
  entry(name) {
    for (const row of this.store.rows || []) { const current = this.state(row.id);
      const tool = current.tools.find(tool => `${row.id}__${shortName(tool.name)}` === name && row.allowed_tools.includes(tool.name) && !tool.unavailable);
      if (tool && current.status === 'connected') return { row, current, tool };
    }
  }
  isRemote(name) { return [...this.runtime.keys()].some(id => name.startsWith(`${id}__`)); }
  isReadOnly(name) { return this.entry(name)?.tool.readOnly === true; }
  async call(name, args, { signal } = {}) {
    const entry = this.entry(name); if (!entry) throw Error('Connector tool is unavailable');
    if (!entry.tool.validate(args)) throw Error('Invalid connector tool arguments');
    try { return await entry.current.client.callTool({ name: entry.tool.name, arguments: args }, undefined, { signal, timeout: 45000 }); }
    catch (error) { if (error.name === 'UnauthorizedError' || entry.current.authorizationUrl) { entry.current.status = 'signin'; throw Error('Reconnect this connector in Tools & connectors'); } throw Error('Remote tool request failed; check connector status and retry if appropriate'); }
  }
  async close() { await Promise.allSettled([...this.runtime.values()].map(value => value.client?.close())); await this.store.tail; }
}

export const remoteMcp = new RemoteMcpRegistry();
