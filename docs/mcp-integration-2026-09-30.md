# Bonfire MCP integration report — 30 September 2026

## Delivered

- Qwen3.5-9B Q4_K_M is the app default, loaded from D: with Vulkan GPU offload, an 8192 token context, one inference slot, native Jinja tools, and thinking disabled.
- App inference moved to port 8082 to avoid the port 8080 conflict observed with Steam. The benchmark remains on 8081.
- Streamed function names and JSON argument fragments are collected into native tool calls. Real MCP results are returned in tool messages before the next model turn.
- Official MCP SDK stdio clients discover explicitly allowed read-only tools. Input schemas are validated with Ajv; unknown tools cannot execute. Names are scoped by server.
- The starter server lists and reads text in `D:\Projects\bonfire-mcp`. It cannot write, execute commands, or read paths outside that dedicated folder.
- Chat displays tool activity and saves arguments and result previews in SQLite, accessible after conversation reloads.
- Model calls and tool steps have bounded outputs and step budgets. Stop/disconnect propagates cancellation. Invalid/incomplete streamed calls fail explicitly.
- Launchers share the model configuration and start hidden processes. Shutdown targets Bonfire paths and its model port, rather than killing arbitrary listeners or every llama server.
- Backend dependency audit reported no vulnerabilities after compatible transitive dependency updates.

See [configuration and examples](mcp-tools.md). Existing user changes remain uncommitted.

## Validation

| Check | Result |
| --- | --- |
| Backend unit/integration tests | 39 passed |
| Deterministic benchmark harness | 11 passed |
| Selected desktop/mobile Playwright tests | 8 passed |
| Production frontend build | Passed |
| PowerShell launcher syntax | Passed |
| Actual shutdown and restart | App ports closed, services restarted healthy |
| Real app smoke cases | 3 passed |

Backend checks include real MCP initialize/discovery/calls, argument validation, parent traversal, absolute paths, junctions escaping the root, unknown/write tools, oversized files, unavailable servers, cancellation, duplicate call IDs, output truncation, fragmented UTF-8/SSE, and incomplete model turns. Database tests verify saved tool activity across reopen.

Browser checks cover startup, online status, rendering/reloading saved tool details, and actual Qwen list→read calls on desktop and mobile. This was a selected browser suite, not every existing frontend test. Three ambiguous selectors were corrected to target the heading, visible conversation button, or answer body rather than hidden tool previews/history text.

Live smoke cases used the actual Express app, Qwen inference, SDK MCP client, and local server, with web search disabled:

1. Plain exact-response chat: passed without tool calls.
2. List files → read bake-off report → compare Dolphin/Qwen/Gemma: correctly reported 50%, 100%, and 87.5%, recommending Qwen. Roughly 22 seconds in the final recorded smoke run.
3. Attempt to read `../bonfire-models/private.txt`: the server denied access and Qwen reported the denial honestly. Roughly 5 seconds in that run.

Smoke traces are saved in ignored `backend/bench/results/mcp-smoke.json`. Test-created conversations are deleted individually; existing conversations are retained. No hosted LLM calls or search credits were used.

An initial question asking for “all three main pass rates” received only Qwen metrics. It was clarified to explicitly request the task pass percentage for each named model, after which Qwen returned the full comparison. The initial result is retained in `mcp-smoke-initial.json`. Native tool support does not guarantee perfect interpretation of ambiguous requests.

## Current limits

- Local stdio transport and text outputs only. Remote HTTP MCP, resources/prompts, multimodal results, and write authorization flows are not implemented.
- The allowlist and annotations govern exposure; trusted MCP executables are ordinary local processes, not sandboxed programs.
- Failed/disconnected servers require a backend restart to reconnect.
- Long tool text is truncated and flagged. Chat retains a short result preview; follow-up questions needing full evidence should reread the file.
- The 8192 token context is finite. Large histories, schemas, or evidence can still exceed the model context and produce an explicit error.
- Timings are observations from this machine, affected by cache warmth and other work, not a formal new model benchmark.
- Steam was not running during the final shutdown test. The shutdown script no longer targets port 8080 and scopes model termination to this repository and port 8082; preservation of a live Steam process was not exercised in that run.

## Next experiments

Start with a read-only telemetry MCP server for GPU/CPU/memory and inference timing. Pair it with experiment records in SQLite so Bonfire can answer questions such as “Which model has the best successful tool-task latency while staying within my VRAM?” Another useful experiment is local retrieval over edge-computing notes, returning short cited passages rather than whole files.
