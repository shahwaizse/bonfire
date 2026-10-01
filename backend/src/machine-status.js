// Compact common status; detailed raw counters/history remain separate MCP tools.
export function compactMachineStatus(hardware, inference, limit = 1) {
  return {
    hardware: { captured_at: hardware.captured_at, sample_age_seconds: hardware.sample_age_seconds,
      cpu: hardware.cpu, memory: hardware.memory, amd_gpus: hardware.amd_gpus,
      windows_gpu_memory: hardware.windows_gpu_memory, notes: hardware.notes },
    inference: { captured_at: inference.captured_at, model: inference.model,
      weighted_generation_tokens_per_second: inference.weighted_generation_tokens_per_second,
      average_over_completed_turns: inference.recent_turns.filter(turn => turn.completed && turn.generation_tokens_per_second !== null).length,
      recent_turns: inference.recent_turns.slice(0, limit).map(turn => ({ timestamp: turn.timestamp,
        generated_tokens: turn.generated_tokens, generation_tokens_per_second: turn.generation_tokens_per_second,
        prompt_tokens_processed: turn.prompt_tokens_processed, prompt_ms: turn.prompt_ms, first_output_ms: turn.first_output_ms })),
      note: 'Recorded turns, not a fresh benchmark. Missing values are unavailable.' },
  };
}
