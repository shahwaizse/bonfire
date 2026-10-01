# RX 6600 XT performance tuning — October 1, 2026

## Result

Bonfire now uses the fastest reliable combination found in this experiment. In three repeated local measurements, uncached first answer text fell from **4.88 seconds to 1.02 seconds**. Sustained generation in the 128-token output case increased from **29.34 to 35.46 tokens/sec**. Long-context first text fell from **23.37 to 6.95 seconds**.

These are measured improvements on this workstation, not a guarantee for every prompt. The work applied compatible optimizations, benchmarked alternatives, and retained the winners. It did not enable every item in the earlier optimization inventory: several options compete with one another or require a different runtime, hardware, or quality tradeoff.

## Hardware and retained runtime

- Ryzen 5 3600, Radeon RX 6600 XT 8 GB, 16 GB system RAM; Windows.
- Gemma 4 E4B IT **Q4_K_M**, model stored on D:.
- Existing llama.cpp Release/native/Vulkan build, commit `3e61ea0`.
- Context 8192; one inference slot; all model layers requested on GPU; embedded native Jinja tool template; thinking off.
- Flash Attention **on**; batch **1024**, microbatch **128**; full sliding-window attention cache (`--swa-full`).
- Bounded **512 MiB** host prompt cache; F16 KV cache; six generation and batch CPU threads.
- No speculative draft model by default. No GPU overclock, driver installation, BIOS change, paid service, or operating-system migration.

The driver was already recent (32.0.21045.5002, August 17, 2026). A workload sample showed 95% GPU activity, 60°C edge / 66°C hotspot and a 2609 MHz core clock. That sample did not indicate a thermal bottleneck; it is not a full thermal stress test.

## Before / after

Median of three repetitions per scenario. TTFT means the first non-whitespace **answer-content** chunk seen by the local benchmark client. It excludes tool-call fragments. Browser paint is not included.

| Scenario | Before | After | Improvement |
| --- | ---: | ---: | ---: |
| Uncached short question, TTFT | 4,881 ms | 1,024 ms | 79% less wait; 4.77× faster |
| Warm follow-up, TTFT | 277 ms | 134 ms | 52% less wait |
| Uncached 128-token output, TTFT | 5,028 ms | 1,031 ms | 79% less wait |
| Same output case, generation | 29.34 tok/s | 35.46 tok/s | 21% faster |
| Uncached long context, TTFT | 23,370 ms | 6,945 ms | 70% less wait; 3.36× faster |
| Returning to the initial prompt, TTFT | 50 ms | 41 ms | Small cache-hit improvement |

Final additional profile-switch checks measured about 392 ms when switching out and 595 ms when returning. There is no matching baseline for that scenario, so no before/after percentage is claimed.

The user questions remained the same, but the production system prompt and tool descriptions were intentionally shortened: the short case processed 1,090 prompt tokens before and 659 afterward. The long case processed 3,593 before and 3,162 afterward. Separate runtime screening held the original payload fixed: reducing microbatch size with Flash Attention brought short TTFT to roughly 1.8 seconds before the prompt reduction. Consequently, the headline improvement combines runtime tuning and app changes.

The fixed 128-token case deliberately ends at its token limit to compare sustained decoding. Production still rejects truncated answers explicitly. The short and long-context answer cases completed normally; the final direct scenarios produced no unexpected tool calls.

### Actual backend requests

Thirteen isolated app requests exercised persisted chat, streaming IDs and real workspace/machine MCP tools. Only the benchmark's own temporary conversations were deleted afterward.

- Warm new-chat first text: **142 ms median**. One request immediately after backend restart took **1.64 seconds**, including startup work; startup is not instant.
- Follow-up first text: **137 ms median**.
- Workspace list/count answer first text: **730 ms median**.
- Combined GPU/inference report: roughly **2.2 seconds** to begin the substantive answer. One trial emitted a pre-tool preface at 73 ms, then completed at 2.55 seconds; that preface is not presented as a completed status report.
- Timeless question with Web enabled and an explicit no-search instruction: **83 ms** first text, no hosted search call.
- All thirteen returned nonempty answers without errors; stored assistant text and IDs matched the stream.

The compact combined machine result cut an earlier roughly five-second status-answer wait to about 2.2 seconds. Cached MCP dispatch itself was only a few milliseconds; most remaining time is model planning and reading the tool result.

## Applied changes

### Inference and prompt processing

- Tuned Flash Attention, batch/microbatch size and full SWA cache for this GPU.
- Enabled bounded host prompt reuse and startup warming of common plain/guy prefixes. Warmup executes no tools, creates no chats and records no fake timing samples.
- Stable guy instructions and capability-specific instructions appear before the changing local date. Duplicate tool listings and instructions were removed.
- Only assigned capabilities receive their additional prompt rules; native tool descriptions were shortened.
- History uses actual local tokenizer counts with a default 2,400-token history budget. The latest user input is preserved. This budget does not guarantee that a very large latest message will fit the total context.
- GPU requests share one priority queue. Chats outrank queued mascot generation and warmup; tool continuations receive priority. Work already running is not preempted.
- Native parallel tool calling enabled. Up to three complete, validated read-only calls from one turn can execute concurrently. Side effects remain sequential; dependent calls still wait for evidence.

### Tools and data

- Tool JSON is parsed once into a compact evidence envelope instead of nested escaped JSON. Truncation and context limits remain explicit.
- Simple machine reports can use one combined tool with a compact hardware/timing summary. It derives permission only from both existing machine read permissions, or an explicit assignment.
- A persistent PowerShell helper compiles the AMD probe once and samples every five seconds. The first sample took about 1.27 seconds; reads reuse a sample with its timestamp and age. Samples older than 15 seconds are rejected.
- Windows GPU counters use CIM rather than repeated blocking counter sampling.
- Successful real text searches use a bounded 30-second cache; parsed pages use a bounded 60-second cache. Cached evidence exposes retrieval timestamps. Extremely fast-changing facts can therefore be slightly stale within those windows.
- Web prefetch runs for changing facts and explicit verification, rather than every Web-enabled message. Page reads remain available as native tools instead of automatically fetching extra pages.
- Tool validators compile once. Scoped tool catalogs, app lists and tokenizer counts are cached with bounded or invalidated storage.
- Timing-file writes are serialized asynchronously and flushed on shutdown.

### Frontend and lifecycle

- First answer text renders immediately; subsequent token updates batch once per animation frame.
- Completed streams reconcile the persisted user/assistant IDs without downloading the whole conversation again. Aborted streams still reload saved state.
- Inactive message bubbles and Markdown plugin configuration avoid unnecessary work.
- Stop scripts include the owned desktop/machine MCP processes and sensor helper. Unrelated processes are left alone.

## Alternatives tested and rejected

Most screening candidates used one repetition and the unchanged baseline payload. The newer runtime and Q4_0 confirmation used three repetitions. Screening establishes a local tuning choice, not a universal ranking.

| Option | Observation | Decision |
| --- | --- | --- |
| Flash Attention off | Short TTFT about 8.5 s; generation about 24 tok/s | Keep on |
| Larger microbatches | 256 improved the original setup, but 128 reduced long prefill further; 1024 was worse | Keep 128 |
| Q8 KV cache | Short TTFT about 5.8 s and long-context about 15.6 s in screening | Keep F16 |
| Compact SWA/checkpoint alternative | Worse profile-switch reuse in the tested setup | Keep full SWA |
| CPU threads 2 / 4 / 8 | Little change around 1.8 s fixed-payload TTFT | Keep six |
| Gemma assistant MTP draft, two/three tokens | No sustained win; tested runs slower than ordinary decoding | Off by default |
| N-gram speculation | No meaningful improvement in these prompts | Off |
| Newer official llama.cpp v0.5.0 / b11146 | Fixed-payload short TTFT 2.34 s versus roughly 1.81 s; long 10.41 s versus roughly 8.81 s. About 4% better decoding | Keep original build for lower first-text latency |
| Q4_0 main model | Fixed-payload short TTFT 1.61 s, long 8.12 s; modest speed win, but tool score 13/16 versus Q4_K_M's 14/16 | Keep Q4_K_M |

The Q4_0 and alternative runtime downloads remain on D: for future experiments. The Q4_0 file's SHA-256 matched upstream metadata: `4a403d2e4d80281063e4f517b1c061ded8476b4011a4fc2ba7dbff707075547e`.

## Remaining options and practical limits

- GPU offload, Release/native Vulkan build, one slot, native tool formatting, streaming, low sampling overhead and thinking-off were already enabled and retained.
- More aggressive weight/KV quantization, a smaller model or a reduced context can save resources, but require another accuracy/context evaluation. Q4_0 already demonstrated the tradeoff here.
- ROCm/HIP, Linux, LiteRT-LM/WebGPU and other inference engines remain separate experiments. They require compatibility work and a fresh native-tool benchmark; they were not adopted as an unmeasured replacement.
- Larger context, more parallel slots, extra draft models and loading multiple models compete for this 8 GB GPU's memory. No concurrent-model routing was enabled.
- GPU overclock/undervolt, power-plan changes, driver replacements and hardware upgrades were not necessary to obtain this gain. The existing balanced power plan remains.
- Retrieval/history summaries, full chat virtualization, plain-text rendering during streaming, background schedules, and more aggressive per-tool caching remain possible future changes. They were not implemented in this pass.
- Output caps cannot speed the first token; they bound total work. No blanket shorter-answer limit was introduced.
- Startup warming can delay a request that arrives while a warmup is already running. The queue prioritizes waiting user requests but cannot preempt GPU work.
- Three repetitions are enough to show the large observed improvement, not to establish tail latency or performance while gaming. Warm caches, context size, tool output, GPU contention and request timing still matter.

## Validation and reproduction

- Backend unit/integration suite: **60/60 passed**.
- Frontend TypeScript and production build: **passed**.
- Native fixture quality: Q4_K_M **14/16**, Q4_0 **13/16**. The retained model still fails the known asset-comparison discovery case and a strict MCP-definition keyword check. Faster inference did not make those weaknesses disappear.
- Native routing: **22/22 passed** in the final one-pass fixture check (nine web, three images, eight no-tool, one page read, one workspace list). This used deterministic provider evidence and real local inference, without paid provider requests. This small sample does not supersede broader tool-quality failures or guarantee arbitrary routing.
- Collaborative browser check: a fresh Just Bonfire chat displayed a complete answer and saved the matching reply. Its temporary conversation was removed after inspection. Preview screenshots failed during the final check; DOM inspection and focused browser interactions succeeded. No browser-paint timing is claimed.

Raw results and backups are on `D:\Projects\bonfire-latency\optimization`, including `baseline.json`, `final.json`, `final-payload.json`, `app-performance-final.json`, `search-routing-final.json`, and runtime/quantization screening outputs. Source backups before this pass are `backend-before` and `scripts-before`; credentials were not copied into the report. The API benchmark measures local streaming, not browser paint.

From the repository root, with the app running:

```powershell
node backend/bench/performance.js --label final --repeat 3 --switch true --out D:/Projects/bonfire-latency/optimization/final.json
node backend/bench/app-performance.js D:/Projects/bonfire-latency/optimization/app-performance-final.json
```

From `backend`:

```powershell
npm test
node bench/search-routing.js 1 D:/Projects/bonfire-latency/optimization/search-routing-final.json
```

Run inference benchmarks sequentially on an idle GPU. Runtime tuning launches an isolated server on 8081; stop production inference first to avoid sharing GPU memory or contaminating timings. Do not use a fixture benchmark's latency while another benchmark is still running.

Runtime settings have environment overrides in `scripts/model-settings.ps1`. For the prior runtime configuration, use `LLAMA_BATCH_SIZE=2048`, `LLAMA_UBATCH_SIZE=512`, `LLAMA_CACHE_RAM=0`, `LLAMA_SWA_FULL=false`, and `LLAMA_FLASH_ATTN=auto`, then restart. This restores runtime flags, not the old app prompt. `BONFIRE_WARMUP=false` disables warming; `MAX_HISTORY_TOKENS` controls history budget. Restore individual source files from the D: backup if needed; do not reset unrelated uncommitted work.

### Implementation references

Runtime flag meanings are documented in the [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md). The alternative build came from the [official v0.5.0 release](https://github.com/ggml-org/llama.cpp/releases/tag/v0.5.0). The quantization candidate came from [Unsloth's Gemma 4 E4B GGUF repository](https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF). Google describes Gemma's speculative assistant in its [multi-token prediction article](https://blog.google/innovation-and-ai/technology/developers-tools/multi-token-prediction-gemma-4/); the advertised acceleration did not materialize in our tested Vulkan setup.
