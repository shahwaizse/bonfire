import { database } from './db.js';
import { AppTools } from './app-tools.js';
import { GuyTools } from './little-guys.js';
import { desktopApps } from './desktop-apps.js';
import { buildChatMessages } from './prompting.js';
import { healthCheck, streamCompletionTurn } from './llama.js';
import { DiscoverableTools } from './tool-discovery.js';

// Bounded startup work. Never invokes tools, stores chats or records fake speed samples.
export async function warmModelPrefixes() {
  if (process.env.BONFIRE_WARMUP === 'false') return;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (await healthCheck()) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (!ready) return;
  const signal = AbortSignal.timeout(30000);
  for (const guy of [database.listLittleGuys()[0], null].filter(value => value !== undefined)) {
    const tools = new DiscoverableTools(new GuyTools(new AppTools(), guy, guy?.allowed_tools.some(name => name.startsWith('desktop__')) ? await desktopApps.list() : []), { signal });
    const catalog = await tools.catalog();
    const messages = buildChatMessages({ history: [{ role: 'user', content: 'Hello.' }], allowedTools: catalog.map(tool => tool.function.name), guy });
    for await (const _ of streamCompletionTurn(messages, { tools: catalog, signal, maxTokens: 1, priority: 20, recordStats: false })) { /* Only warm native prompt processing. */ }
  }
}
