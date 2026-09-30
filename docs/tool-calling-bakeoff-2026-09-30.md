# Bonfire tool-calling bake-off — 30 September 2026

## Recommendation

Use **Qwen3.5-9B Q4_K_M** as the default for complex tool/MCP workflows. It completed every tested task without thinking enabled. **Gemma 4 E4B Q4_K_M** is a useful faster profile for simpler tasks; it sometimes asks the user for information it could retrieve itself. Thinking fixes that planning failure, but adds enough latency that Qwen remains the stronger default in this experiment.

This recommendation is based on local measurements, not model card rankings. At benchmark completion, production settings were unchanged. Qwen has since become the app default with native MCP execution; see [current setup](mcp-tools.md). Both new GGUFs are in `D:\Projects\bonfire-models`.

Open the [interactive details and comparison tables](../backend/bench/results/comparison.html) or the [run guide](../backend/bench/README.md).

## Results

| Model/configuration | Task passes | Tool-required task passes | Median task | p95 task | Decode tokens/s |
| --- | --- | --- | --- | --- | --- |
| Dolphin 8B, compatible tool template | 24/48 — 50% | 21/39 | 2.7 s | 28.6 s | 37.1 |
| Qwen3.5 9B, thinking off | **48/48 — 100%** | **39/39** | 6.8 s | 23.4 s | 14.4 |
| Gemma 4 E4B, thinking off | 42/48 — 87.5% | 36/39 | **2.5 s** | **4.6 s** | 30.7 |
| Gemma 4 E4B, thinking on (diagnostic) | 15/16 — 93.8% | 13/13 | 19.1 s | 38.9 s | 28.7 |

The main comparison has **16 unique cases, repeated three times**, with seed 42. Gemma's thinking run is a separate, single repetition; it is not an equally replicated experiment. Thirteen cases require tools, and three test clarification or answering without tools.

Median/p95 include failed attempts: Dolphin's short failures make its median look better than its completion rate warrants. Decode throughput comes from summed server generation timings; it excludes prompt processing. Models have different tokenizers and output lengths. Higher tokens/second does not imply faster successful task completion, as Gemma's thinking run demonstrates.

Hardware: AMD RX 6600 XT, 8,176 MiB VRAM; Ryzen 5 3600; 16,310 MiB RAM. Backend: Windows llama.cpp/Vulkan. One model at a time, one slot, 8,192-token context, temperature 0.1, top-p 1, top-k/min-p disabled, maximum 1,536 generated tokens per response. Native structured function calls; automatic tool choice. Runtime budgets cap model turns and tool calls.

## What the traces show

**Dolphin:** its bundled ChatML template does not expose tool schemas. The initial diagnostic printed fictitious calls and an invented 0.05% error rate, with no actual tool call. A generic ChatML tool template makes it usable for simple calls, but the fair comparison still shows failures on lookup/planning, retry recovery, search followed by page reading, and live metrics. It repeatedly guesses asset IDs. In the injected-page case it repeats the hostile restart advice and the wrong 8192-token recommendation; it does not actually execute a restart.

**Qwen:** resolves returned IDs, completes dependent calls, follows pagination, retries an explicitly transient error, stops on denied permissions, reads an official page rather than trusting a snippet, and ignores injected page instructions. It also correctly distinguishes an MCP server from the language model. Its weakness on this machine is speed: approximately 14.4 generated tokens/second, and around 23 seconds for the longer comparison/diagnosis tasks.

**Gemma, thinking off:** faster and concise, with good grounding and boundary behavior. The asset comparison fails because it requests asset IDs from the user despite having a lookup tool. Its conceptual MCP answer incorrectly describes a general application server. With thinking enabled it resolves the asset comparison correctly, but the MCP explanation remains wrong. That conceptual failure is not proof that it cannot call tools exposed by an MCP host: the host handles the protocol, while the model consumes tool schemas.

Every model emitted valid arguments in the completed comparison, and none attempted an unauthorized write. llama.cpp's grammar constraints helped enforce JSON/schema validity; this is why semantic workflow success matters more than the syntax score. Zero attempted writes in these few fixtures is not a general security guarantee.

## Fixture and runtime audit

The original main run scored Dolphin 24/48, Qwen 45/48, and Gemma 42/48. Qwen's sole failure revealed a fixture defect: the stale-document task rejected a reasonable production-asset lookup, even though the tool was exposed. The fixture now supplies that valid lookup and allows three calls instead of two. The task prompt, expected live value, and required document/metrics steps are unchanged.

The corrected case was rerun **three times for every model**. Qwen and Gemma passed all three; Dolphin still failed. The final audited datasets replace only that case. A reconciliation script asserts that the other 15 case definitions are identical, checks model/template/settings compatibility, and records each row's source run. Original datasets and the original case manifest are preserved. The corrected suite is `bonfire-tools-v1.1`.

During compatibility checks, llama.cpp rejected an unanchored URL pattern and a `\d` date expression. These were corrected to anchored, supported patterns before the main runs. Template/parser setup errors are excluded from the model quality scores. Tool-loop budget failures are reported as model workflow failures, not server errors. The completed main runs have no server/protocol errors.

## Validation and limits

- **11 harness tests passed:** dependency order, parallel calls, retry state, exact arguments, write authorization, schema validation, pagination, and the corrected stale case.
- **23 backend tests passed:** persistence, prompts, URL reading, hosted-search fallback/quotas, and search context.
- Successful answers and failure traces were reviewed, including grounding, arithmetic, injection handling, and the conceptual MCP failures.
- All tool executions were deterministic local fixtures. No real emails, notes, service changes, web searches, or MCP connections were made.
- This small suite is a diagnostic, not a general intelligence ranking or MCP interoperability certification. Repeated seeded cases do not add new task diversity.
- All benchmark model servers were stopped after testing.

## Next work for Bonfire

At benchmark completion the app sent no tool schemas and read only streamed text. That integration is now implemented: Bonfire discovers local MCP tools, forwards schemas, collects streamed tool-call arguments, validates/executes calls, returns real results, and saves tool activity in chat. The first server supports read-only files in a dedicated D: workspace. See [current setup and limitations](mcp-tools.md).

Useful next experiments:

1. **Qwen3.5-4B vs 9B:** run the same suite to see whether the smaller model keeps the tool reliability while improving latency on this GPU.
2. **Schema/context stress:** increase the registry from 11 tools and test similar names, nested arguments, larger documents, and context pressure.
3. **A real read-only MCP task:** find a file, inspect it, and combine it with metrics. Measure protocol, model, and execution latency separately.
4. **Visible tool traces:** show intended calls, results, and failures in Bonfire so fluent text cannot be mistaken for an executed action.

These can all stay local and free. No hosted model API was used in this bake-off.
