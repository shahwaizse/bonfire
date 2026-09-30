import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BACKEND_DIR } from './config.js';

export class McpRegistry {
  constructor({ configPath = process.env.MCP_CONFIG_PATH || path.join(BACKEND_DIR, 'mcp.json'), servers } = {}) {
    this.configPath = path.resolve(BACKEND_DIR, configPath);
    this.servers = servers;
    this.clients = [];
    this.entries = new Map();
    this.status = [];
    this.ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  }
  async initialize() {
    let servers = this.servers;
    if (!servers) {
      try { servers = JSON.parse(await fs.readFile(this.configPath, 'utf8')).servers; }
      catch (error) {
        if (error.code !== 'ENOENT') throw new Error('Invalid MCP configuration');
        servers = [{ name: 'workspace', command: process.execPath, args: [path.join(BACKEND_DIR, 'src/mcp-workspace.js')],
          env: { BONFIRE_MCP_ROOT: process.env.BONFIRE_MCP_ROOT || 'D:/Projects/bonfire-mcp' }, allowTools: ['list_files', 'read_file'] }];
      }
    }
    if (!Array.isArray(servers)) throw new Error('MCP servers must be an array');
    const names = new Set();
    for (const server of servers) {
      if (server.enabled === false) continue;
      let client;
      try {
        if (!/^[a-zA-Z0-9_-]{1,24}$/.test(server.name) || names.has(server.name) || !Array.isArray(server.allowTools)) throw new Error('Require a unique server name and explicit allowTools');
        names.add(server.name);
        client = new Client({ name: 'bonfire', version: '0.3.0' }, { capabilities: {} });
        const transport = new StdioClientTransport({ command: server.command, args: server.args || [],
          cwd: server.cwd || BACKEND_DIR, env: server.env || {}, stderr: 'pipe' });
        transport.stderr?.on('data', () => {});
        await client.connect(transport, { timeout: 15000 });
        const tools = [];
        let cursor;
        const seen = new Set();
        do {
          const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 15000 });
          tools.push(...page.tools);
          cursor = page.nextCursor;
          if (cursor && seen.has(cursor)) throw new Error('Repeated MCP tools cursor');
          if (cursor) seen.add(cursor);
          if (tools.length > 100) throw new Error('Too many MCP tools');
        } while (cursor);
        const entries = [];
        for (const tool of tools) {
          if (!server.allowTools.includes(tool.name)) continue;
          if (!/^[a-zA-Z0-9_-]{1,36}$/.test(tool.name)) throw new Error('Unsupported MCP tool name');
          if (tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint === true) throw new Error('Only declared read-only tools are supported');
          const name = `${server.name}__${tool.name}`;
          entries.push([name, { client, originalName: tool.name, validate: this.ajv.compile(tool.inputSchema),
            schema: { type: 'function', function: { name, description: (tool.description || tool.name).slice(0, 1000), parameters: tool.inputSchema } } }]);
        }
        for (const [name, entry] of entries) this.entries.set(name, entry);
        this.clients.push(client);
        const status = { name: server.name, connected: true, tools: entries.length };
        this.status.push(status);
        client.onclose = () => {
          status.connected = false;
          status.tools = 0;
          status.error = 'MCP server disconnected; restart the backend to reconnect';
          for (const [name] of entries) this.entries.delete(name);
        };
      } catch {
        await client?.close().catch(() => {});
        this.status.push({ name: server.name || 'invalid', connected: false, error: 'MCP connection or tool configuration failed; check the server and allowlist' });
      }
    }
  }
  async catalog() {
    this.ready ||= this.initialize();
    await this.ready;
    return [...this.entries.values()].map(entry => entry.schema);
  }
  async call(name, args, { signal } = {}) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error('Tool is not allowed');
    if (!entry.validate(args)) throw new Error(`Invalid tool arguments: ${this.ajv.errorsText(entry.validate.errors)}`);
    signal?.throwIfAborted();
    return entry.client.callTool({ name: entry.originalName, arguments: args }, undefined, { signal, timeout: 15000 });
  }
  async close() { await Promise.allSettled(this.clients.map(client => client.close())); }
}

export const mcpRegistry = new McpRegistry();
