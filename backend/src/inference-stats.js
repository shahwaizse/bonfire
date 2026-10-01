import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BACKEND_DIR, LLM_MODEL } from './config.js';
export const inferenceStatsPath = path.resolve(BACKEND_DIR, process.env.BONFIRE_INFERENCE_STATS_PATH || 'data/inference-stats.json');
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
let writeQueue = Promise.resolve();
let recorded;
function storedTurns() {
  try { const data = JSON.parse(fs.readFileSync(inferenceStatsPath, 'utf8')); return Array.isArray(data) ? data : []; } catch { return []; }
}
export function flushInferenceStats() { return writeQueue; }
export function readInferenceStats(limit = 5) {
  let turns = [];
  try { const data = JSON.parse(fs.readFileSync(inferenceStatsPath, 'utf8')); if (Array.isArray(data)) turns = data; } catch { }
  const recent = turns.filter(turn => turn.model === LLM_MODEL).slice(-Math.max(1, Math.min(10, limit))).reverse();
  const measured = recent.filter(turn => turn.completed && turn.generation_tokens_per_second !== null);
  const tokens = measured.reduce((sum, turn) => sum + (turn.generated_tokens || 0), 0);
  const seconds = measured.reduce((sum, turn) => sum + (turn.generation_ms || 0) / 1000, 0);
  return { captured_at: new Date().toISOString(), model: LLM_MODEL, recent_turns: recent,
    weighted_generation_tokens_per_second: seconds > 0 ? Math.round(tokens / seconds * 100) / 100 : null,
    note: 'Recorded Bonfire model turns include tool planning and mascot creation. This is not a fresh benchmark or live instantaneous speed. No prompts or answers are stored. Missing measurements mean speed is unavailable.' };
}
export function recordInferenceTurn({ timings, firstOutputMs, wallMs, finishReason }) {
  const entry = { id: randomUUID(), timestamp: new Date().toISOString(), model: LLM_MODEL, completed: ['stop', 'tool_calls'].includes(finishReason), finish_reason: finishReason || 'interrupted',
    source: timings ? 'llama.cpp timings' : 'host elapsed time; token speed unavailable',
    generated_tokens: finite(timings?.predicted_n), generation_ms: finite(timings?.predicted_ms), generation_tokens_per_second: finite(timings?.predicted_per_second),
    prompt_tokens_processed: finite(timings?.prompt_n), prompt_ms: finite(timings?.prompt_ms), prompt_tokens_per_second: finite(timings?.prompt_per_second),
    first_output_ms: firstOutputMs === null ? null : Math.round(firstOutputMs), wall_ms: Math.round(wallMs) };
  try {
    recorded ||= storedTurns();
    recorded = [...recorded.slice(-29), entry];
    const serialized = JSON.stringify(recorded);
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await fsp.mkdir(path.dirname(inferenceStatsPath), { recursive: true });
      const temp = `${inferenceStatsPath}.tmp`;
      await fsp.writeFile(temp, serialized); await fsp.rename(temp, inferenceStatsPath);
    }).catch(() => {});
  } catch { /* Metrics must not break chat. Missing or stale stats remain explicit. */ }
}
