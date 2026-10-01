import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { machineSnapshot, startMachineSampler, stopMachineSampler } from './machine-snapshot.js';
import { readInferenceStats } from './inference-stats.js';
import { compactMachineStatus } from './machine-status.js';
const server = new Server({ name: 'bonfire-machine', version: '1.0.0' }, { capabilities: { tools: {} } });
const annotations = { readOnlyHint: true, destructiveHint: false };
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'get_machine_snapshot', annotations, description: 'Read hardware sampled every 5s: AMD GPU load/temperatures/fan, VRAM, CPU load and RAM. Check timestamps. Null means unavailable, not zero; CPU temperature may be missing. Reads only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_inference_stats', annotations, description: 'Read recorded Bonfire model timings: tokens/sec, prompt processing and first output. Includes tool planning/mascots, not a fresh benchmark. Missing speed is unavailable.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } }, additionalProperties: false } },
  { name: 'get_status', annotations, description: 'Read hardware and recent inference timings together. Prefer this for GPU/temperature/speed status requests needing both. Timestamped samples; null means unavailable.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } }, additionalProperties: false } },
] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
  try {
    const result = params.name === 'get_machine_snapshot' ? await machineSnapshot({ signal: extra.signal }) : params.name === 'get_inference_stats' ? readInferenceStats(params.arguments?.limit || 5) : params.name === 'get_status' ? compactMachineStatus(await machineSnapshot({ signal: extra.signal }), readInferenceStats(5), params.arguments?.limit || 1) : null;
    if (!result) throw new Error('Unknown machine tool');
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
await server.connect(new StdioServerTransport());
startMachineSampler();
process.stdin.on('end', () => { stopMachineSampler(); process.exit(0); });
