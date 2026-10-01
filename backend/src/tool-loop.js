import { streamCompletionTurn } from './llama.js';
import { evidenceFromResult } from './tool-evidence.js';

export async function runToolLoop(messages, { registry, emit, signal, streamTurn = streamCompletionTurn, maxCalls = 10, maxTurns = 8, priority = 0, stopAfterToolResult = () => false } = {}) {
  const transcript = [...messages];
  let callsUsed = 0;
  let totalResultChars = 0;
  let answer = '';
  const usedIds = new Set();
  let retriedEmpty = false;
  const failedCalls = new Map();
  for (let turn = 0; turn < maxTurns; turn++) {
    signal?.throwIfAborted();
    const catalog = await registry.catalog();
    const calls = new Map();
    let content = '';
    let finishReason;
    for await (const choice of streamTurn(transcript, { tools: catalog, signal, priority: turn ? priority - 1 : priority })) {
      signal?.throwIfAborted();
      if (choice.delta?.content) {
        content += choice.delta.content;
        answer += choice.delta.content;
        emit('token', choice.delta.content);
      }
      for (const delta of choice.delta?.tool_calls || []) {
        if (!Number.isInteger(delta.index) || delta.index < 0 || delta.index >= maxCalls) throw new Error('Invalid tool call index');
        const call = calls.get(delta.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        call.id += delta.id || '';
        call.function.name += delta.function?.name || '';
        call.function.arguments += delta.function?.arguments || '';
        if (call.function.arguments.length > 16000) throw new Error('Tool arguments are too large');
        if (call.id.length > 256 || call.function.name.length > 64) throw new Error('Tool call identifier is too large');
        calls.set(delta.index, call);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    if (finishReason === 'length') throw new Error('Model hit its token limit; please shorten the request');
    if (!finishReason) throw new Error('Model stream ended before completing its turn');
    if (!calls.size) {
      if (!answer.trim()) {
        if (retriedEmpty || turn === maxTurns - 1) throw Error('Model returned an empty response');
        retriedEmpty = true;
        transcript.push({ role: 'user', content: 'Your last turn produced no answer or action. Continue the original request using available tools, or give a clear final result.' });
        emit('status', 'Retrying empty model response...');
        continue;
      }
      return answer;
    }
    if (finishReason !== 'tool_calls') throw new Error('Incomplete model tool call');
    if (callsUsed + calls.size > maxCalls || turn === maxTurns - 1) throw new Error('Tool step limit reached; please narrow the request');
    const toolCalls = [...calls.values()];
    const ids = new Set();
    for (const call of toolCalls) {
      if (!call.id || ids.has(call.id) || usedIds.has(call.id) || !call.function.name) throw new Error('Malformed or duplicate tool call');
      ids.add(call.id);
      usedIds.add(call.id);
    }
    transcript.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
    async function execute(call) {
      signal?.throwIfAborted();
      callsUsed++;
      let result;
      let fingerprint;
      try {
        const args = JSON.parse(call.function.arguments);
        emit('tool_call', { id: call.id, name: call.function.name, arguments: args });
        if (!catalog.some(tool => tool.function.name === call.function.name)) throw new Error('Tool is not allowed');
        fingerprint = JSON.stringify([call.function.name, canonical(args)]);
        const previous = failedCalls.get(fingerprint);
        if (previous && (!previous.transient || previous.attempts >= 2)) throw Error('This exact call already failed in this request. Change the command/arguments or inspect another source of evidence; repeating it does not establish success.');
        result = await registry.call(call.function.name, args, { signal });
      } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error;
        result = { isError: true, content: [{ type: 'text', text: error.message }] };
      }
      if (fingerprint && result.isError) {
        const text = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
        failedCalls.set(fingerprint, { attempts: (failedCalls.get(fingerprint)?.attempts || 0) + 1, transient: registry.isReadOnly?.(call.function.name) === true && /ECONNRESET|ETIMEDOUT|temporarily unavailable|rate.?limit|\b429\b|\b503\b/i.test(text) });
      } else if (fingerprint) failedCalls.delete(fingerprint);
      return result;
    }
    const parallel = toolCalls.length > 1 && toolCalls.every(call => registry.isReadOnly?.(call.function.name) === true);
    const results = parallel ? [] : null;
    if (results) for (let offset = 0; offset < toolCalls.length; offset += 3) results.push(...await Promise.all(toolCalls.slice(offset, offset + 3).map(execute)));
    for (let index = 0; index < toolCalls.length; index++) {
      const call = toolCalls[index];
      const result = results ? results[index] : await execute(call);
      const blocks = (result.content || []).filter(block => block.type === 'text');
      // Parse JSON text once, rather than putting escaped JSON inside another text wrapper.
      const values = blocks.map(block => { const text = String(block.text); try { return JSON.parse(text); } catch { return text; } });
      const rawFile = call.function.name === 'files__read_file' && !result.isError && values.length === 1 && typeof values[0]?.content === 'string';
      const text = rawFile
        ? JSON.stringify({ isError: false, truncated: false, data: { ...values[0], content: undefined } }) + '\nFile content (raw):\n' + values[0].content
        : JSON.stringify({ isError: Boolean(result.isError), truncated: blocks.length !== (result.content || []).length, data: values.length === 1 ? values[0] : values });
      const bounded = text.length <= 7000 ? text : JSON.stringify({ isError: Boolean(result.isError), truncated: true, text: text.slice(0, 6000) });
      totalResultChars += bounded.length;
      if (totalResultChars > 20000) throw new Error('Tool context limit reached; please narrow the request');
      let args; try { args = JSON.parse(call.function.arguments); } catch { /* malformed call */ }
      emit('tool_result', { id: call.id, name: call.function.name, isError: Boolean(result.isError), summary: bounded.slice(0, 400), evidence: evidenceFromResult(call.function.name, args, result, values) });
      transcript.push({ role: 'tool', tool_call_id: call.id, content: bounded });
      if (stopAfterToolResult(call, result)) return answer;
    }
    emit('status', 'Generating answer...');
  }
  throw new Error('Tool step limit reached');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
