// Owns only benchmark child processes on 8081; never stops arbitrary processes.
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = 'D:/Projects/bonfire-latency/optimization';
const exe = process.env.BENCH_LLAMA_EXE || path.join(root, 'vendor/llama.cpp/build/bin/llama-server.exe');
const model = process.env.BENCH_MODEL_PATH || 'D:/Projects/bonfire-models/gemma-4-E4B-it-Q4_K_M.gguf';
const draft = 'D:/Projects/bonfire-models/gemma-4-E4B-it-assistant.Q8_0.gguf';
const phase = process.argv[2] || 'gpu';
const candidates = phase === 'confirm-quant' ? [
  ['q4_0-confirmed', ['-fa', 'on', '-b', '1024', '-ub', '128', '--cache-ram', '512', '--swa-full']],
] : phase === 'threads' ? [
  ['threads2', ['-fa', 'on', '-b', '1024', '-ub', '128', '--cache-ram', '512', '--swa-full', '-t', '2', '-tb', '2']],
  ['threads4', ['-fa', 'on', '-b', '1024', '-ub', '128', '--cache-ram', '512', '--swa-full', '-t', '4', '-tb', '4']],
  ['threads8', ['-fa', 'on', '-b', '1024', '-ub', '128', '--cache-ram', '512', '--swa-full', '-t', '8', '-tb', '8']],
] : phase === 'confirm-latest' ? [
  ['latest-confirmed', ['-fa', 'on', '-b', '1024', '-ub', '128', '--cache-ram', '512', '--swa-full']],
] : phase === 'latest' ? [
  ['latest-swa-full', ['-fa', 'on', '-b', '1024', '-ub', '128', '--cache-ram', '512', '--swa-full']],
  ['latest-mtp2', ['-fa', 'on', '-b', '1024', '-ub', '128', '--cache-ram', '512', '--swa-full', '--spec-type', 'draft-mtp', '--model-draft', draft, '--spec-draft-n-max', '2', '--n-gpu-layers-draft', '999']],
] : phase === 'quant' ? [
  ['q4_0', ['-fa', 'on', '-b', '1024', '-ub', '128', '--cache-ram', '512', '--swa-full']],
] : phase === 'gpu' ? [
  ['flash-on', ['-fa', 'on']],
  ['flash-off', ['-fa', 'off']],
  ['flash-on-ub256', ['-fa', 'on', '-b', '1024', '-ub', '256']],
  ['flash-on-ub1024', ['-fa', 'on', '-b', '2048', '-ub', '1024']],
  ['flash-on-q8', ['-fa', 'on', '-ctk', 'q8_0', '-ctv', 'q8_0']],
] : phase === 'refine' ? [
  ['ub128', ['-fa', 'on', '-b', '1024', '-ub', '128']],
  ['ub256-b2048', ['-fa', 'on', '-b', '2048', '-ub', '256']],
  ['q8-ub256', ['-fa', 'on', '-b', '1024', '-ub', '256', '-ctk', 'q8_0', '-ctv', 'q8_0']],
] : phase === 'spec' ? [
  ['mtp-2', ['-fa', 'on', '--spec-type', 'draft-mtp', '--model-draft', draft, '--spec-draft-n-max', '2', '--n-gpu-layers-draft', '999']],
  ['mtp-3', ['-fa', 'on', '--spec-type', 'draft-mtp', '--model-draft', draft, '--spec-draft-n-max', '3', '--n-gpu-layers-draft', '999']],
  ['ngram', ['-fa', 'on', '--spec-type', 'ngram-simple']],
] : phase === 'cache' ? [
  ['cache512-checkpoint256', ['-fa', 'on', '--cache-ram', '512', '--checkpoint-min-step', '256', '--ctx-checkpoints', '8']],
  ['cache512-swa-full', ['-fa', 'on', '--cache-ram', '512', '--swa-full']],
] : [];
if (!candidates.length) throw new Error('Choose gpu, spec or cache');
await fs.mkdir(output, { recursive: true });
const results = [];
let current;
async function stop() {
  if (!current || current.exitCode !== null || current.signalCode !== null) return;
  const child = current; const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done;
}
process.on('SIGINT', () => { void stop().finally(() => process.exit(130)); });
try {
  for (const [label, flags] of candidates) {
    console.log(`START ${label}`);
    const log = createWriteStream(path.join(output, label + '.log'));
    const args = ['-m', model, '--alias', 'gemma', '--host', '127.0.0.1', '--port', '8081', '-c', '8192', '-ngl', '999', '-np', '1', '--jinja', '--reasoning', 'off', '--cache-ram', '0', ...(phase === 'spec' || phase === 'cache' ? ['-b', '1024', '-ub', phase === 'cache' ? '128' : '256'] : []), ...flags];
    current = spawn(exe, args, { windowsHide: true, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    current.stdout.pipe(log); current.stderr.pipe(log);
    try {
      let healthy = false;
      for (let i = 0; i < 120; i++) {
        if (current.exitCode !== null) throw new Error(`Server exited ${current.exitCode}`);
        try { if ((await fetch('http://127.0.0.1:8081/health', { signal: AbortSignal.timeout(1500) })).ok) { healthy = true; break; } } catch { }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!healthy) throw new Error('Startup timed out');
      const child = spawn(process.execPath, [path.join(root, 'backend/bench/performance.js'), '--url', 'http://127.0.0.1:8081', '--label', label, '--repeat', phase.startsWith('confirm-') ? '3' : '1', '--out', path.join(output, label + '.json'), '--payload', path.join(output, 'baseline-payload.json'), '--switch', phase === 'cache' ? 'true' : 'false'], { windowsHide: true, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let lines = ''; child.stdout.on('data', chunk => { lines += chunk; }); child.stderr.on('data', chunk => { lines += chunk; });
      const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
      if (code !== 0) throw new Error(lines.slice(-1000));
      const report = JSON.parse(await fs.readFile(path.join(output, label + '.json'), 'utf8'));
      results.push({ label, flags, rows: report.rows });
      for (const row of report.rows) console.log(`${label} ${row.label}: TTFT ${Math.round(row.ttft_ms)}ms; ${row.timing?.predicted_per_second?.toFixed(1)} tok/s; finish ${row.finish}`);
      if (phase === 'confirm-quant') {
        const quality = spawn(process.execPath, [path.join(root, 'backend/bench/run.js'), '--model', 'gemma', '--url', 'http://127.0.0.1:8081', '--repeat', '1', '--out', path.join(output, 'q4_0-quality.json')], { windowsHide: true, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
        quality.stdout.on('data', chunk => process.stdout.write(chunk)); quality.stderr.on('data', chunk => process.stderr.write(chunk));
        await new Promise((resolve, reject) => { quality.once('exit', code => code === 0 ? resolve() : reject(new Error('Quality benchmark failed'))); quality.once('error', reject); });
      }
    } catch (error) { results.push({ label, flags, error: error.message }); console.log(`FAILED ${label}: ${error.message}`); }
    finally { await stop(); log.end(); }
    await fs.writeFile(path.join(output, 'tuning-' + phase + '.json'), JSON.stringify(results, null, 2));
  }
} finally { await stop(); }
