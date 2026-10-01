# Local model and MCP tools

Bonfire defaults to Gemma 4 E4B Q4_K_M on the RX 6600 XT, with thinking disabled and native llama.cpp Jinja tool calling. The model lives at `D:\Projects\bonfire-models\gemma-4-E4B-it-Q4_K_M.gguf`. App inference uses port **8082**; benchmarks use 8081. Port 8080 belongs to Steam on this machine.

Start with `scripts/start-all-and-wait.ps1`. Stop with `scripts/stop-all.ps1`. Override the model path using `BONFIRE_MODEL_PATH` before launching; native Jinja formatting uses the model's embedded template. Backend sampling is set in `backend/.env`: temperature 0.1, top_p 1, min_p 0, repeat penalty 1, max output 2048. Chat requests also disable thinking. See the [performance report](performance-optimization-2026-10-01.md) for runtime tuning.

## Try it

The default local MCP server exposes two read-only tools: list files and read UTF-8 text. Its shared folder is **D:\Projects\bonfire-mcp**. This folder contains a welcome file and a copy of the bake-off report. Copy learning notes into this folder to make them available to Bonfire.

On a fresh setup, create the folder before starting. Set `BONFIRE_MCP_ROOT` in `backend/.env` to use another dedicated folder. Keep credentials and private configuration outside it.

Try: “List the shared workspace, find the model bake-off report, read it, and explain why Qwen was chosen. Use the real tools.”

Chat streams tool activity while it runs, then keeps a collapsible **Tools used** section with arguments and result previews. Tool activity survives conversation reloads. Tool calls and results are passed to the model in native assistant/tool messages within the current request. Saved conversation history retains answer text and an audit preview; a follow-up needing exact evidence should read the file again.

## Connect another local server

Copy `backend/mcp.example.json` to `backend/mcp.json` (Git ignored) and add a server entry. Use an installed executable and its arguments; Bonfire does not download or install servers automatically. Paths resolve from `backend` unless `cwd` is supplied. Each entry needs a unique short `name` and explicit `allowTools`. Set `enabled: false` to disable an entry. An empty `servers` array disables configured servers; the built-in desktop server remains available for explicitly configured little guys. Add an entry with `name: "desktop", enabled: false` to disable that server too. Restart the backend after configuration changes.

Read-only tools require an explicit `allowTools` entry and no destructive hint. A non-read-only tool additionally requires its exact name in `allowSideEffects`, plus `destructiveHint: false`. The built-in desktop server explicitly opts in only `launch_app`; normal Bonfire chat does not get desktop tools. Custom guys must select the tool and permitted apps in their profiles. Tool names become `server__tool` to avoid collisions. Inspect and trust server code before allowing it: annotations describe intent and are not a process sandbox. Server processes receive a small SDK-provided environment plus the explicit `env` object, rather than all backend secrets. Do not put paid services in this configuration if you want to keep Bonfire free.

The implementation uses the [official MCP SDK](https://ts.sdk.modelcontextprotocol.io/client) with stdio transport. `/tools` shows the available MCP, local filesystem and hosted-search schemas and server connection status; `/health` includes MCP status. A failed server is omitted so normal chat can continue. Restart the backend to reconnect a failed server. This first implementation supports text tools over local stdio; remote Streamable HTTP servers are supported through [Tools & connectors](remote-mcp.md). MCP image/resource blocks and prompts are not implemented. The configured Windows/Steam launcher is an explicit side-effect tool. Separate native [filesystem tools](filesystem-tools.md) provide reads, writes, exact edits and backups within per-guy folder assignments, using the official filesystem package's atomic-write helper. An optional native Bash command tool uses the assigned folder as its working directory; it is not an OS sandbox. Hosted image search is available separately through the chat host.

## Limits

- 8 model turns and 10 tool calls per request; dependent calls execute in order. Complete, validated read-only calls within a single model turn can run concurrently, with at most three in flight. App launches remain sequential.
- Local MCP initialize, discovery and calls have 15 second timeouts; remote HTTP operations have 45 second timeouts. Client disconnects abort inference and outstanding tool requests.
- Input arguments are validated with JSON Schema before execution. Unknown tools never execute.
- Tool evidence has size limits to fit the 8192 token model context. Responses exceeding the output token limit fail explicitly.
- Workspace reads reject absolute paths, parent traversal, links escaping the root, non-text files and files above 24 KB. Lists show up to 100 entries without recursing. Keep secrets outside the shared folder.
- Long text results are truncated to 6000 characters and marked as truncated; completed chat keeps only a 400 character result preview.
- Search still uses the separate Web toggle, Tavily/Brave chain, free-only confirmations and quota ledger. MCP tools do not use search credits.

## Useful next experiments

1. Extend the built-in machine watcher with historical sampling and charts comparing gaming and inference workloads.
2. A local SQLite tool server: let Bonfire look up experiment runs and calculate comparisons using bounded queries.
3. Local retrieval over your learning notes, returning short passages with file names and line numbers.
4. Route easy questions to Gemma and tool-heavy requests to Qwen; benchmark total latency including model switching before adopting it.
5. Replay the bake-off against actual MCP servers to compare protocol errors and task accuracy with the deterministic fixtures.

## Little guys

[Custom agent setup](little-guys.md): choose one guy per conversation, provide instructions, select exact tools and assign launchable apps. Tools outside its selection are omitted and rejected at dispatch. Existing conversations retain the assigned guy; deleting that guy leaves history readable but blocks continuation rather than silently changing its permissions.

The built-in `machine` server supplies three read-only tools: `get_machine_snapshot`, `get_inference_stats` and compact combined `get_status`. The combined tool is available to a guy with both original permissions, or an explicit assignment. See [measurement sources and limits](little-guys.md#watch-the-machine). It remains available alongside `desktop` when configured `servers` is empty; disable either built-in server with an entry bearing its name and `enabled: false`.
