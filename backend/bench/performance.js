// Local-only latency benchmark. No hosted searches, app launches or user chats.
import fs from 'node:fs/promises';
import { buildChatMessages } from '../src/prompting.js';

const flags = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, args) => i % 2 ? pairs : [...pairs, [value.replace(/^--/, ''), args[i + 1]]], []));
const base = flags.url || 'http://127.0.0.1:8082';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Benchmark requires a local server');
const out = flags.out || 'D:/Projects/bonfire-latency/performance.json';
const repeat = Number(flags.repeat || 3);
const catalog = (await (await fetch('http://127.0.0.1:8000/tools')).json()).tools.filter(tool => !/^(desktop|machine)__/.test(tool.function.name) && tool.function.name !== 'search_web');
const messages = buildChatMessages({ history: [{ role: 'user', content: 'Explain what RAM does in one short sentence. No tools are needed.' }], webEnabled: false, allowedTools: catalog.map(tool => tool.function.name) });
const payload = { model: 'gemma', messages, tools: catalog, tool_choice: 'auto', parallel_tool_calls: false, temperature: 0.1, top_p: 1, top_k: 0, min_p: 0, repeat_penalty: 1, seed: 42, max_tokens: 160, stream: true, timings_per_token: true, chat_template_kwargs: { enable_thinking: false } };
if (flags.payload) Object.assign(payload, JSON.parse(await fs.readFile(flags.payload, 'utf8')));
if (flags['save-payload']) await fs.writeFile(flags['save-payload'], JSON.stringify(payload, null, 2));
const rows = [];
async function measure(label, body) {
  const started = performance.now(); let first = null, answer = '', timing = null, finish = null, toolCalls = [];
  const response = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  let buffer = ''; const decoder = new TextDecoder();
  function consume(line) {
    if (!line.startsWith('data: ') || line.trim() === 'data: [DONE]') return;
    const item = JSON.parse(line.slice(6)); if (item.error) throw new Error(item.error.message);
    timing = item.timings || timing;
    const choice = item.choices?.[0]; if (!choice) return;
    if (choice.delta?.content) { answer += choice.delta.content; if (first === null && choice.delta.content.trim()) first = performance.now() - started; }
    if (choice.delta?.tool_calls) toolCalls.push(...choice.delta.tool_calls);
    finish = choice.finish_reason || finish;
  }
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i; while ((i = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
  }
  consume(buffer + decoder.decode());
  const row = { label, ttft_ms: first, total_ms: performance.now() - started, timing, finish, answer, unexpected_tool_calls: toolCalls.length };
  rows.push(row); console.log(JSON.stringify({ ...row, answer: answer.slice(0, 90) }));
  await fs.writeFile(out, JSON.stringify({ label: flags.label, base, repeat, payload_characters: JSON.stringify(payload).length, rows }, null, 2));
  return answer;
}
for (let i = 0; i < repeat; i++) {
  const answer = await measure('uncached-short', { ...payload, cache_prompt: false });
  await measure('warm-followup', { ...payload, cache_prompt: true, messages: [...payload.messages, { role: 'assistant', content: answer }, { role: 'user', content: 'Now explain VRAM in one short sentence. No tools needed.' }] });
  await measure('return-to-initial', { ...payload, cache_prompt: true });
  if (flags.switch === 'true') {
    await measure('switch-profile-out', { ...payload, cache_prompt: true, tools: payload.tools.filter(tool => tool.function.name.startsWith('workspace__')), messages: [{ role: 'system', content: payload.messages[0].content + '\nYou are Archivist. Focus on explaining computers clearly.' }, payload.messages[1]] });
    await measure('switch-profile-return', { ...payload, cache_prompt: true });
  }
  if (flags.quick !== 'true') {
    await measure('uncached-long-output', { ...payload, cache_prompt: false, max_tokens: 128, messages: [payload.messages[0], { role: 'user', content: 'Explain how RAM and VRAM differ, including bandwidth, latency, capacity, allocation, and their roles in local LLM inference. Use five detailed paragraphs. No tools needed.' }] });
    await measure('uncached-long-context', { ...payload, cache_prompt: false, max_tokens: 32, messages: [payload.messages[0], { role: 'user', content: 'Reference notes:\n' + 'A computer has RAM for CPU tasks and VRAM for GPU tasks. Models benefit from resident weights and cached attention states.\n'.repeat(100) + '\nSummarize these notes in one short sentence. No tools needed.' }] });
  }
}
const median = values => { const sorted = values.filter(Number.isFinite).sort((a,b) => a-b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
for (const label of [...new Set(rows.map(row => row.label))]) {
  const group = rows.filter(row => row.label === label);
  console.log(JSON.stringify({ label, median_ttft_ms: median(group.map(row => row.ttft_ms)), median_decode_tps: median(group.map(row => row.timing?.predicted_per_second)), median_prompt_tps: median(group.map(row => row.timing?.prompt_per_second)) }));
}
