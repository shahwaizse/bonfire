import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { desktopApps } from './desktop-apps.js';

const server = new Server({ name: 'bonfire-desktop', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'list_apps', description: 'List the configured application IDs and names. A little guy only sees apps its owner has assigned.', annotations: { readOnlyHint: true, destructiveHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'launch_app', description: 'Launch an application explicitly configured by the owner using its app_id. Use only when the user requests opening it. No command, path or arguments are accepted. Returns launch_requested, not a verified window-opened result.', annotations: { readOnlyHint: false, destructiveHint: false }, inputSchema: { type: 'object', properties: { app_id: { type: 'string', minLength: 1, maxLength: 64 } }, required: ['app_id'], additionalProperties: false } },
] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
  try {
    let result;
    if (params.name === 'list_apps') result = { apps: (await desktopApps.list()).map(({ id, name, kind }) => ({ id, name, kind })) };
    else if (params.name === 'launch_app') result = await desktopApps.launch(params.arguments.app_id, { signal: extra.signal });
    else throw new Error('Unknown desktop tool');
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
await server.connect(new StdioServerTransport());
