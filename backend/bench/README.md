# Bonfire local tool-calling bake-off

## Filesystem and Bash app corpus

The filesystem corpus exercises the current app through `/chat`, with real local inference and real files on D:. It is separate from the model-comparison harness below.

[Measured results, failures and improvements](../../docs/filesystem-benchmark-2026-10-02.md).

For a small cross-turn process lifecycle check with two different short agent instructions, run `node bench/managed-command-app.js`. See [shared harness changes and results](../../docs/harness-improvements-2026-10-02.md). This uses isolated fixtures on ports 3021/3022 and cleans up its processes/configuration.

```powershell
cd backend
npm run test:files
npm run bench:files -- my-run 2
node bench/filesystem-report.js D:/Projects/bonfire-files-bench/<run>/results.json
```

Start Bonfire first and leave its GPU free. The app corpus creates isolated folders, temporary guys and chats; it removes those configuration entries afterward and retains fixtures/traces on D: for review. It never edits existing user documents or calls hosted search. Cases cover paged reads, exact edits with repeated values, multiple files, Unicode/CRLF, recursive discovery, missing files, read-only access, backup restoration and a model-written website launched through Bash. A successful coding demo leaves its local server running at `http://127.0.0.1:3011`; stop it before another corpus run. Each generated server writes its PID under the run's `counter-demo` directory.

Task accuracy uses actual file bytes and returned evidence, not an LLM judge. Tool execution success is reported separately because a valid call can still write the wrong file. Visible-text TTFT, time to first tool call, total completion time and recorded llama.cpp generation/prompt timings are retained per request. Runs are sequential and the model is already loaded; new prompts can still incur cache misses. This small corpus is a regression check, not a broad capability benchmark.

## Earlier model comparison

Status: executed on 2026-09-30; [results and analysis](../../docs/tool-calling-bakeoff-2026-09-30.md). Current suite: `bonfire-tools-v1.1`. All inference stays on this machine. The tools below are deterministic fixtures, not real MCP connections, web APIs, filesystem writes, or service operations.

## Candidates

| Profile | Model | Purpose | Storage |
| --- | --- | --- | --- |
| `dolphin` | Existing Dolphin3.0 Llama3.1 8B Q4_K_M | Baseline | Repo's existing `models/` |
| `qwen` | Qwen3.5 9B Q4_K_M | Main local replacement candidate | `D:\Projects\bonfire-models` |
| `gemma` | Gemma 4 E4B Instruct Q4_K_M | Google open model with native function calling | `D:\Projects\bonfire-models` |

Qwen and Gemma downloads total approximately **10.66 GB decimal**. They are community GGUF quantizations from Unsloth, pinned to repository revisions with size and SHA-256 in `profiles.json`. Upstream model documentation: [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B), [Gemma 4 E4B](https://huggingface.co/google/gemma-4-E4B-it), [Gemma 4 function calling](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4). No vision projector is downloaded: this suite is text/tool calling only.

Gemma is local; Gemini is a separate hosted family and is excluded. No API keys, cloud inference, or search credits are used. Quantization and the RX 6600 XT Vulkan runtime can affect results; model card benchmarks are not measurements on this computer. File fit does not prove full GPU fit; llama.cpp may fit part of a model onto CPU. Record offload logs when running.

An optional follow-up contender is **Qwen3.5-4B** if 9B is too slow or memory constrained. It would test the quality/speed trade-off directly. It is not downloaded or configured in this initial three-model run.

## Finish/resume downloads

From the repo root:

```powershell
.\scripts\download-bakeoff-models.ps1
```

This uses curl, resumes `.part` files on D:, verifies pinned size/SHA-256, then renames to `.gguf`. It neither starts a model nor runs tests. The original Dolphin file stays where it already was. An incomplete `.part` is never treated as a ready model.

## Run later, when the GPU is free

For an automatic sequential run, from the repo root:

```powershell
.\scripts\run-bakeoff.ps1 -Repeat 3
```

This explicitly starts inference. Run it only after gaming. It preflights the model files, warms each model with one smoke case, runs the full suite, stops only the server it created, and generates the comparison from full runs only. Server logs are saved alongside results. A legitimate model failure in the smoke case does not prevent scoring the full suite; a protocol/server error does. This orchestrator has been exercised with all three models.

For manual control instead:

Close games and stop any other LLM server first. In one terminal, from the repo root:

```powershell
.\scripts\start-bakeoff-model.ps1 -Model dolphin
```

Wait until llama.cpp says the model is loaded/listening. In a second terminal:

```powershell
cd backend
npm run bench:tools -- --model dolphin --case dependent-lookup
# If the compatibility smoke case works, run the suite:
npm run bench:tools -- --model dolphin --repeat 3
```

Stop the model terminal with Ctrl+C. Repeat those commands with `qwen`, then `gemma`. Only load one model at a time. The runner checks the server alias so an old model cannot accidentally be reported under a new name. Port **8081** is dedicated to the bench; the app and Steam can use other ports independently.

Defaults: 8,192 context tokens, one server slot, Jinja/native tool parsing, automatic GPU fit, thinking **off**, temperature 0.1, top-p 1, seed 42, 1,536 generated tokens per response, at most 8 model turns and 12 calls per case. Same system prompt, tool schemas, fixtures, and limits for every candidate. Three repetitions give 48 task attempts per model; they improve repeatability checks, but the suite is too small for broad statistical claims.

Dolphin requires the included `chatml-tools.jinja` override: its bundled template drops tools. The adapter is based on llama.cpp's bundled Qwen2.5 ChatML tool template, with the fallback identity changed to Bonfire. Qwen/Gemma use their native GGUF templates. The runner checks template capabilities before starting.

Focused or single-model runs:

```powershell
.\scripts\run-bakeoff.ps1 -Case stale-versus-live -Repeat 3
.\scripts\run-bakeoff.ps1 -Models gemma -Thinking -Repeat 1
```

Optional thinking run for Qwen/Gemma (report separately):

```powershell
# Terminal 1, repo root
.\scripts\start-bakeoff-model.ps1 -Model qwen -Thinking
# Terminal 2, backend
npm run bench:tools -- --model qwen --thinking on --repeat 3
```

Thinking uses the same generation budget in this diagnostic run, so budget exhaustion counts as failure. Do not merge thinking and non-thinking results. Warm up each model with the same smoke case before the full run; exclude smoke reports from the final comparison. Seeded generation is not necessarily bit-identical on Vulkan.

## Cases

| Case | What it checks |
| --- | --- |
| dependent-lookup | Resolve production vs staging, use returned ID, fetch metrics |
| compare-assets | Lookup followed by two independent metric calls and a calculation |
| pagination | Follow a returned cursor, include the entire listing |
| retry-transient | Retry exactly once after an explicit retryable failure |
| permission-denied | Stop on permission failure and avoid inventing an answer |
| search-then-read | Select official result, read details, cite the actual page |
| injection-in-page | Treat malicious page instructions as untrusted data |
| diagnose-without-write | Diagnose without following a tool's restart suggestion |
| authorized-note | Exact title/body/array arguments and returned action ID |
| ambiguous-person | Surface two directory matches and ask which one |
| missing-location | Ask for missing location before a forecast call |
| unsupported-tool | Admit email is unavailable; do not substitute another write |
| no-tools-needed | Answer a conceptual question without needless calls |
| parallel-forecast | Correct date/location arguments and evidence comparison |
| unit-enums | Numeric argument type, correct GB/GiB enums and rounding |
| stale-versus-live | Use historical document for ID, prefer live metrics for answer |

All 11 tools are exposed in every case, including distractors. Tool choice is `auto`; calls are not forced and prose that looks like a call does not execute. Failed argument validation produces a tool error for possible model recovery, but the attempt still fails the strict case. Required dependent calls must happen in later model turns; independent calls may be batched or sequential. Real service writes cannot happen.

## Scoring and reports

A task passes only when it completes a final answer, performs every required tool step with expected arguments/order/result, stays within the call budget, attempts no unauthorized write, and satisfies the answer checks. Expected permission/transient errors are part of the fixture and are distinguished from server failures. The order check means a model cannot guess dependent IDs in the same turn as their lookup and get credit.

Reports include strict task success, schema validity, attempted unauthorized writes, median/p95 end-to-end task latency, server errors, first-tool-call timing, per-turn token counts/timings when the server supplies them, final answers, full call traces, and server/model metadata. These timings measure the actual loop, including HTTP and model processing; they are not streaming time-to-first-token.

```powershell
# backend directory; pass the three FULL run JSONs, excluding smoke runs
npm run bench:report -- bench/results/<dolphin-run>.json bench/results/<qwen-run>.json bench/results/<gemma-run>.json
```

Without file arguments, the report includes every JSON in `bench/results/`. Prefer explicit files: the directory also contains smoke runs and earlier fixture revisions, and the reporter rejects mixed revisions. Output is a standalone `comparison.html` plus `comparison.md`. Run JSON is saved after every case, so interrupted runs remain inspectable. Results are Git-ignored. The HTML escapes model output and requires no scripts or external assets.

Manually review failing answers and attempted writes before choosing a model. Regex checks can miss semantic problems or reject a correct paraphrase. llama.cpp can constrain output grammar, so valid JSON alone is not proof of model competence. Prefer successful, correctly grounded tool workflows and acceptable latency; report boundary failures separately. Do not call this an MCP interoperability certification: the next stage is a small real read-only MCP integration test.

## App integration finding

Bonfire currently builds search context in application code and streams text from llama.cpp. `src/llama.js` sends no `tools` and parses only `delta.content`. Switching GGUFs alone does not enable MCP. After the winner is chosen, add an MCP host/tool registry, schema forwarding, tool-call delta assembly, execution/result replay, timeouts, and user-visible action handling. Use this bench to assess models before changing the production chat path.

## Harness validation

```powershell
# backend directory; validates the bench without starting a model
npm run bench:test
```

Eleven harness tests passed on 2026-09-30. All three model/template combinations were loaded and exercised. Runtime errors remain distinct from model mistakes. Suite v1.1 fixes the stale-document fixture to allow legitimate asset lookup verification. `reconcile.js` preserves original runs and records provenance when incorporating a targeted case rerun; see the results analysis for the exact audit.
