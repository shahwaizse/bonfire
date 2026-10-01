import fs from 'node:fs/promises';
const runs = [];
const args = process.argv.slice(2), outputIndex = args.indexOf('--output');
const inputs = outputIndex < 0 ? args : args.slice(0, outputIndex);
const destination = outputIndex < 0 ? null : args[outputIndex + 1];
const quantile = (items, q) => { const sorted = items.filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length) return null; if (q === .5 && sorted.length % 2 === 0) return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2; return sorted[Math.ceil(q * sorted.length) - 1]; };
const seconds = value => value === null ? null : Math.round(value / 10) / 100;
for (const filename of inputs) {
  const data = JSON.parse(await fs.readFile(filename, 'utf8'));
  // Correct the original missing-file rubric: an empty directory listing proves absence.
  for (const row of data.rows.filter(row => row.category === 'missing-honesty')) {
    delete row.checks['called:files__read_file']; delete row.checks.expected_tool_error;
    row.checks.evidence = row.events.some(event => event.type === 'tool_result' && ['files__read_file', 'files__list_directory'].includes(event.name));
    row.passed = Object.values(row.checks).every(Boolean);
  }
  // Older script didn't require generated artifacts in the requested directory.
  for (const row of data.rows.filter(row => row.category === 'coding-demo')) {
    for (const name of ['index.html', 'server.cjs']) { try { await fs.access(data.root + '/counter-demo/' + name); row.checks[`file:${name}`] = true; } catch { row.checks[`file:${name}`] = false; } }
    row.passed = Object.values(row.checks).every(Boolean);
  }
  const tasks = data.rows.filter(row => row.category !== 'plain-reference');
  const corpus = tasks.filter(row => /-r\d+$/.test(row.id));
  const refs = data.rows.filter(row => row.category === 'plain-reference');
  const calls = tasks.flatMap(row => row.events.filter(event => event.type === 'tool_call'));
  const results = tasks.flatMap(row => row.events.filter(event => event.type === 'tool_result'));
  const turns = tasks.flatMap(row => row.model_turns || []).filter(turn => turn.generation_ms > 5 && turn.generated_tokens > 1);
  const tokens = turns.reduce((sum, turn) => sum + (turn.generated_tokens || 0), 0);
  const generationMs = turns.reduce((sum, turn) => sum + (turn.generation_ms || 0), 0);
  const promptMs = turns.reduce((sum, turn) => sum + (turn.prompt_ms || 0), 0);
  const categories = [...new Set(tasks.map(row => row.category))].map(category => {
    const rows = tasks.filter(row => row.category === category);
    return { category, passed: rows.filter(row => row.passed).length, attempts: rows.length, median_seconds: seconds(quantile(rows.map(row => row.total_ms), .5)), ttft_seconds: seconds(quantile(rows.map(row => row.ttft_ms), .5)), calls: rows.map(row => row.events.filter(event => event.type === 'tool_call').length), failures: rows.filter(row => !row.passed).map(row => ({ id: row.id, checks: Object.entries(row.checks).filter(([, value]) => !value).map(([key]) => key), errors: row.errors, answer: row.answer })) };
  });
  const toolDurations = results.map(event => {
    const call = calls.find(call => call.id === event.id); return call ? event.at_ms - call.at_ms : null;
  });
  const summary = { label: data.label, source: filename, measured_at: data.measured_at, passed: tasks.filter(row => row.passed).length, attempts: tasks.length,
    accuracy_percent: Math.round(tasks.filter(row => row.passed).length / tasks.length * 1000) / 10,
    corpus_passed: corpus.filter(row => row.passed).length, corpus_attempts: corpus.length,
    corpus_median_seconds: seconds(quantile(corpus.map(row => row.total_ms), .5)), corpus_p95_seconds: seconds(quantile(corpus.map(row => row.total_ms), .95)),
    corpus_median_ttft_seconds: seconds(quantile(corpus.map(row => row.ttft_ms), .5)),
    median_seconds: seconds(quantile(tasks.map(row => row.total_ms), .5)), p95_seconds: seconds(quantile(tasks.map(row => row.total_ms), .95)),
    median_ttft_seconds: seconds(quantile(tasks.map(row => row.ttft_ms), .5)), median_first_tool_seconds: seconds(quantile(tasks.map(row => row.first_tool_ms), .5)),
    plain_median_seconds: seconds(quantile(refs.map(row => row.total_ms), .5)), plain_ttft_seconds: seconds(quantile(refs.map(row => row.ttft_ms), .5)),
    tool_calls: calls.length, tool_results: results.length, tool_errors: results.filter(row => row.isError).length,
    tool_execution_success_percent: Math.round(results.filter(row => !row.isError).length / results.length * 1000) / 10,
    passed_after_tool_error: tasks.filter(row => row.passed && row.category !== 'missing-honesty' && row.events.some(event => event.type === 'tool_result' && event.isError)).map(row => row.id),
    median_tool_execution_ms: quantile(toolDurations, .5), p95_tool_execution_ms: quantile(toolDurations, .95),
    failed_tasks_without_tool_errors: tasks.filter(row => !row.passed && !row.events.some(event => event.type === 'tool_result' && event.isError)).map(row => row.id),
    measured_model_turns: turns.length, generation_tokens: tokens, weighted_generation_tokens_per_second: generationMs ? Math.round(tokens / generationMs * 100000) / 100 : null,
    recorded_prompt_seconds: seconds(promptMs), recorded_generation_seconds: seconds(generationMs), categories };
  runs.push(summary);
}
if (destination) await fs.writeFile(destination, JSON.stringify(runs, null, 2));
else console.log(JSON.stringify(runs, null, 2));
