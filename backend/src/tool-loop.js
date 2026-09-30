import { streamCompletionTurn } from './llama.js';

export async function runToolLoop(messages, { registry, emit, signal, streamTurn = streamCompletionTurn, maxCalls = 10, maxTurns = 8 } = {}) {
  const catalog = await registry.catalog();
  const transcript = [...messages];
  let callsUsed = 0;
  let totalResultChars = 0;
  let answer = '';
  const usedIds = new Set();
  for (let turn = 0; turn < maxTurns; turn++) {
    signal?.throwIfAborted();
    const calls = new Map();
    let content = '';
    let finishReason;
    for await (const choice of streamTurn(transcript, { tools: catalog, signal })) {
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
    if (!calls.size) return answer;
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
    for (const call of toolCalls) {
      signal?.throwIfAborted();
      callsUsed++;
      let result;
      try {
        const args = JSON.parse(call.function.arguments);
        emit('tool_call', { id: call.id, name: call.function.name, arguments: args });
        if (!catalog.some(tool => tool.function.name === call.function.name)) throw new Error('Tool is not allowed');
        result = await registry.call(call.function.name, args, { signal });
      } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error;
        result = { isError: true, content: [{ type: 'text', text: error.message }] };
      }
      const blocks = (result.content || []).filter(block => block.type === 'text');
      const text = JSON.stringify({ isError: Boolean(result.isError),
        truncated: blocks.some(block => String(block.text).length > 6000) || blocks.length !== (result.content || []).length,
        content: blocks.map(block => ({ type: 'text', text: String(block.text).slice(0, 6000) })) });
      const bounded = text.length <= 7000 ? text : JSON.stringify({ isError: Boolean(result.isError), truncated: true, text: text.slice(0, 6000) });
      totalResultChars += bounded.length;
      if (totalResultChars > 20000) throw new Error('Tool context limit reached; please narrow the request');
      emit('tool_result', { id: call.id, name: call.function.name, isError: Boolean(result.isError), summary: bounded.slice(0, 400) });
      transcript.push({ role: 'tool', tool_call_id: call.id, content: bounded });
    }
    emit('status', 'Generating answer...');
  }
  throw new Error('Tool step limit reached');
}
