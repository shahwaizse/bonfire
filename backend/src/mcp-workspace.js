import fs from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const root = await fs.realpath(process.env.BONFIRE_MCP_ROOT || 'D:/Projects/bonfire-mcp');
async function safePath(relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || /(^|[\\/])\.{2}([\\/]|$)/.test(relative) || relative.includes(':')) throw new Error('Only paths inside the shared workspace are allowed');
  const resolved = await fs.realpath(path.resolve(root, relative));
  const difference = path.relative(root, resolved);
  if (difference === '..' || difference.startsWith(`..${path.sep}`) || path.isAbsolute(difference)) throw new Error('Path is outside the shared workspace');
  return resolved;
}
const server = new Server({ name: 'bonfire-workspace', version: '1.0.0' }, { capabilities: { tools: {} } });
const annotations = { readOnlyHint: true, destructiveHint: false };
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'list_files', description: 'List files in the shared learning workspace. Start here to discover paths. Does not recurse.', annotations,
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Relative directory path; use . for the root.' } }, required: ['path'], additionalProperties: false } },
  { name: 'read_file', description: 'Read a UTF-8 text file in the shared learning workspace, using its relative path from list_files.', annotations,
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Relative file path.' } }, required: ['path'], additionalProperties: false } },
] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    if (!['list_files', 'read_file'].includes(params.name)) throw new Error('Unknown tool');
    if (!params.arguments || Object.keys(params.arguments).some(key => key !== 'path')) throw new Error('Invalid arguments');
    const target = await safePath(params.arguments.path);
    let text;
    if (params.name === 'list_files') {
      const entries = await fs.readdir(target, { withFileTypes: true });
      text = JSON.stringify({ entries: entries.slice(0, 100).map(entry => ({ name: entry.name, type: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file' })), truncated: entries.length > 100 });
    } else {
      const handle = await fs.open(target, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 24000) throw new Error('Read supports text files up to 24 KB');
        const buffer = Buffer.alloc(24001);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 24000) throw new Error('Read supports text files up to 24 KB');
        text = buffer.subarray(0, bytesRead).toString('utf8');
        if (text.includes('\u0000') || text.includes('\uFFFD')) throw new Error('File is not UTF-8 text');
      } finally { await handle.close(); }
    }
    return { content: [{ type: 'text', text }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.code ? 'Unable to access this workspace path' : error.message }] }; }
});
await server.connect(new StdioServerTransport());
