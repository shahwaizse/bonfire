// Real local inference, fixture tools, no saved chats or hosted API requests.
import fs from 'node:fs/promises';
import { buildSystemPrompt, CORE_SYSTEM_PROMPT } from '../src/prompting.js';
import { parseCompletionStream } from '../src/llama.js';
import { runToolLoop } from '../src/tool-loop.js';
import { searchToolSchemas } from '../src/app-tools.js';

const variants = process.argv[2] === 'current' ? ['current'] : ['baseline', 'focused'];
const out = process.argv[3] || 'D:/Projects/bonfire-latency/guy-instructions.json';
const profiles = await (await fetch('http://127.0.0.1:8000/little-guys')).json();
const meg = profiles.find(guy => guy.name === 'Meg');
if (!meg) throw Error('Meg profile missing');
const topic = /megan\s+fox|megax\s+fox/i;
const mentionsTopic = answer => topic.test(answer);
const scenarios = [
  { id: 'meg-hi', guy: meg, message: 'hi', check: mentionsTopic },
  { id: 'meg-weather', guy: meg, message: "weather's nice isn't it?", check: mentionsTopic },
  { id: 'meg-initiative', guy: meg, message: 'hmm, what do YOU want to do?', check: mentionsTopic },
  { id: 'meg-capabilities', guy: meg, message: 'what can you do?', check: mentionsTopic },
  { id: 'meg-off-topic', guy: meg, message: 'Explain RAM in one sentence.', check: mentionsTopic },
  { id: 'meg-stale-history', guy: meg, history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hi! How can I help you today?' }], message: "weather's nice isn't it?", check: mentionsTopic },
  { id: 'meg-implicit-pictures', guy: meg, message: 'show me some pictures', images: true, check: mentionsTopic },
  { id: 'meg-picture-followup', guy: meg, history: [{ role: 'user', content: 'Show me pictures of Megan Fox.' }, { role: 'assistant', content: 'Here are pictures of Megan Fox.' }], message: 'more from red carpets please', images: true, check: mentionsTopic },
  { id: 'custom-urdu', guy: { name: 'UrduPal', tagline: 'Urdu conversation buddy', instructions: 'Reply in Urdu, including greetings.', allowed_tools: [] }, message: 'hi', check: answer => /[\u0600-\u06ff]/u.test(answer) },
  { id: 'custom-format', guy: { name: 'Tiny', tagline: 'Short replies', instructions: 'Start every reply with BEEP. Use one short sentence.', allowed_tools: [] }, message: 'What is RAM?', check: answer => /^BEEP\b/.test(answer.trim()) },
  { id: 'plain-chat', guy: null, message: 'Explain RAM in one sentence.', check: answer => /memory/i.test(answer) && !topic.test(answer) },
];

function focusedPrompt(options) {
  const old = buildSystemPrompt(options);
  if (!options.guy) return old;
  const guy = options.guy;
  const oldRole = `You are ${guy.name}, the user's little guy. ${guy.tagline}\nCustom instructions:\n${guy.instructions}\nComplete requested actions with assigned tools.`;
  return `You are ${guy.name}, a little guy in Bonfire. ${guy.tagline}\n\nOwner's instructions:\n${guy.instructions}\n\nYour role and the owner's instructions define how you respond. Carry them into greetings, follow-ups and tool queries. Earlier assistant replies are conversation history; apply the current instructions on this turn.\n\n` + old.replace(CORE_SYSTEM_PROMPT, CORE_SYSTEM_PROMPT.split('\n').slice(1).join('\n')).replace(oldRole + '\n', '');
}
async function* streamTurn(messages, { tools, signal }) {
  const response = await fetch('http://127.0.0.1:8082/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ model: 'gemma', messages, ...(tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: true } : {}), stream: true,
      temperature: 0.1, top_p: 1, top_k: 0, min_p: 0, repeat_penalty: 1, seed: 42, max_tokens: 384, cache_prompt: true, chat_template_kwargs: { enable_thinking: false } }) });
  if (!response.ok) throw Error(`Model HTTP ${response.status}`);
  yield* parseCompletionStream(response.body);
}
const rows = [];
for (const variant of variants) for (const item of scenarios) {
  const calls = [], events = [];
  const tools = item.guy?.allowed_tools.includes('search_images') ? searchToolSchemas.filter(tool => tool.function.name === 'search_images') : [];
  const options = { guy: item.guy, webEnabled: false, allowedTools: tools.map(tool => tool.function.name) };
  const system = variant === 'focused' ? focusedPrompt(options) : buildSystemPrompt(options);
  const registry = { catalog: async () => tools, isReadOnly: () => true, call: async (name, args) => {
    calls.push({ name, args });
    return { content: [{ type: 'text', text: JSON.stringify({ query: args.query, gallery_displayed: true, images: [{ title: 'Megan Fox red carpet fixture', source_url: 'https://example.com/gallery' }] }) }] };
  } };
  const start = performance.now(); let answer = '', error;
  try { answer = await runToolLoop([{ role: 'system', content: system }, ...(item.history || []), { role: 'user', content: item.message }], {
    registry, streamTurn, signal: AbortSignal.timeout(60000), emit: (type, data) => events.push({ type, data }), maxCalls: 3, maxTurns: 4,
  }); } catch (failure) { error = failure.message; }
  const passed = !error && item.check(answer) && (!item.images || calls.some(call => call.name === 'search_images' && topic.test(call.args.query)));
  const row = { variant, id: item.id, passed, unexpected_tools: !item.images && calls.length > 0,
    wrong_identity: Boolean(item.guy && /(?:I am|I'm|As) Bonfire\b/i.test(answer)),
    seconds: (performance.now() - start) / 1000, message: item.message, system, calls, answer, error };
  rows.push(row); console.log(JSON.stringify({ ...row, system: undefined }));
  await fs.writeFile(out, JSON.stringify({ measured_at: new Date().toISOString(), model: 'Gemma 4 E4B Q4_K_M', seed: 42, fixture_tools: true, rows }, null, 2));
}
for (const variant of variants) { const group = rows.filter(row => row.variant === variant); console.log(JSON.stringify({ variant, passed: group.filter(row => row.passed).length, total: group.length })); }
