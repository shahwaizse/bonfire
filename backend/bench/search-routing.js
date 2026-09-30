import fs from 'node:fs/promises';
import { AppTools } from '../src/app-tools.js';
import { mcpRegistry } from '../src/mcp.js';
import { runToolLoop } from '../src/tool-loop.js';
import { buildChatMessages } from '../src/prompting.js';

const cases = [
  { id: 'latest-anthropic', message: "what's Anthropic's latest model?", expected: 'search_web', query: /anthropic|claude/i },
  { id: 'current-weather', message: 'Is it raining in Karachi right now?', expected: 'search_web', query: /karachi/i },
  { id: 'gpu-price', message: 'What does an RX 6600 XT cost in Pakistan this week?', expected: 'search_web', query: /6600/i },
  { id: 'llama-release', message: 'What is the latest llama.cpp release?', expected: 'search_web', query: /llama/i },
  { id: 'current-best-model', message: 'Which local model should I download today for tool calling on an 8GB GPU? Check current options.', expected: 'search_web' },
  { id: 'provider-pricing', message: 'Does Brave Search API still have free credits? Verify its current pricing.', expected: 'search_web', query: /brave/i },
  { id: 'explicit-verification', message: 'Find an official source explaining what MCP stands for.', expected: 'search_web', query: /mcp|model context protocol/i },
  { id: 'dated-version', message: 'As of September 2026, which Node.js LTS should I use?', expected: 'search_web', query: /node/i },
  { id: 'timeless-mcp', message: 'Explain MCP in simple terms in two sentences.', expected: 'none' },
  { id: 'simple-code', message: 'Write a Python function that returns the median of a list. No dependencies.', expected: 'none' },
  { id: 'arithmetic', message: 'What is 17 percent of 240?', expected: 'none' },
  { id: 'translation', message: 'Translate "Good morning" into Urdu.', expected: 'none' },
  { id: 'provided-evidence', message: 'My benchmark says Qwen passed 48/48 and Gemma 42/48. Compare their percentages using only these numbers.', expected: 'none' },
  { id: 'offline-constraint', message: 'Without web access, explain your general understanding of transformer attention. Keep it short.', expected: 'none' },
  { id: 'general-capabilities', message: 'What can you do?', expected: 'none' },
  { id: 'image-code', message: 'Write a React component to display an array of image URLs. Do not search.', expected: 'none' },
  { id: 'pictures-megan', message: 'bring up pictures of megan fox', expected: 'search_images', query: /megan.*fox/i },
  { id: 'pictures-aurora', message: 'Show me photos of auroras over Norway.', expected: 'search_images', query: /aurora|norway/i },
  { id: 'image-follow-up', history: [{ role: 'user', content: 'Show pictures of Megan Fox.' }, { role: 'assistant', content: 'Here are photos of Megan Fox.' }], message: 'More from the red carpet please.', expected: 'search_images', query: /megan.*fox/i },
  { id: 'topic-switch', history: [{ role: 'user', content: 'Show pictures of Megan Fox.' }, { role: 'assistant', content: 'Here are photos of Megan Fox.' }], message: "what's Anthropic's latest model?", expected: 'search_web', query: /anthropic|claude/i },
  { id: 'supplied-url', message: 'Read https://modelcontextprotocol.io/introduction and summarize it.', expected: 'read_webpage' },
  { id: 'filesystem', message: 'List the files in the shared workspace.', expected: 'workspace__list_files' },
];
const mcpCatalog = await mcpRegistry.catalog();
const results = [];
try {
  for (let repetition = 1; repetition <= 2; repetition++) {
    for (const item of cases) {
      const events = [];
      const registry = new AppTools({ webEnabled: true,
        mcp: { catalog: async () => mcpCatalog, call: async () => ({ content: [{ type: 'text', text: '{"entries":[{"name":"notes.txt","type":"file"}]}' }] }) },
        searchFn: async query => [{ title: `Test fixture: ${query}`, url: 'https://example.com/fixture', snippet: `This is controlled test evidence for ${query}, dated September 30, 2026. The current sample release is Fixture-2026. Only this fixture was retrieved.`, source: 'fixture', kind: 'web' }],
        imageSearchFn: async query => [{ url: 'https://images.example.com/fixture.jpg', thumbnail: 'https://images.example.com/fixture.jpg', source_url: 'https://example.com/gallery', title: query, description: '', source: 'fixture' }],
        readFn: async url => ({ url, title: 'Official documentation fixture', excerpt: 'MCP means Model Context Protocol, an interface between AI applications and external tools/data.' }),
      });
      const start = performance.now();
      let answer = '';
      let error;
      try {
        answer = await runToolLoop(buildChatMessages({ history: [...(item.history || []), { role: 'user', content: item.message }], webEnabled: true }),
          { registry, signal: AbortSignal.timeout(120000), maxCalls: 4, maxTurns: 4, emit: (type, data) => events.push({ type, data }) });
      } catch (failure) { error = failure.message; }
      const calls = events.filter(event => event.type === 'tool_call').map(event => event.data);
      const matched = calls.filter(call => call.name === item.expected);
      const passed = !error && Boolean(answer.trim()) && (item.expected === 'none' ? calls.length === 0 : matched.length > 0 &&
        (!item.query || matched.some(call => item.query.test(call.arguments.query || ''))) &&
        !calls.some(call => item.expected === 'search_web' && call.name === 'search_images' || item.expected === 'search_images' && call.name === 'search_web'));
      results.push({ id: item.id, repetition, expected: item.expected, passed, seconds: (performance.now() - start) / 1000, calls, answer, error });
      console.log(`${repetition}/2 ${item.id}: ${passed ? 'PASS' : 'FAIL'} (${calls.map(call => call.name).join(', ') || 'no tools'})`);
    }
  }
} finally { await mcpRegistry.close(); }
await fs.mkdir('bench/results', { recursive: true });
const groups = ['search_web', 'search_images', 'none', 'read_webpage', 'workspace__list_files'].map(expected => {
  const rows = results.filter(result => result.expected === expected);
  return { expected, passes: rows.filter(result => result.passed).length, total: rows.length };
});
await fs.writeFile('bench/results/search-routing.json', JSON.stringify({ date: new Date().toISOString(), runtime: 'real Qwen inference/native tools; deterministic provider fixtures; no paid API requests', groups, results }, null, 2));
console.log(JSON.stringify(groups));
