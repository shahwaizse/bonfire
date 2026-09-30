# Local model and MCP tools

Bonfire defaults to Qwen3.5-9B Q4_K_M on the RX 6600 XT, with thinking disabled and native llama.cpp Jinja tool calling. The model lives at `D:\Projects\bonfire-models\Qwen3.5-9B-Q4_K_M.gguf`. App inference uses port **8082**; benchmarks use 8081. Port 8080 belongs to Steam on this machine.

Start with `scripts/start-all-and-wait.ps1`. Stop with `scripts/stop-all.ps1`. Override the model path using `BONFIRE_MODEL_PATH` before launching; the default tool template is intended for Qwen. Backend sampling is set in `backend/.env`: temperature 0.1, top_p 1, min_p 0, repeat penalty 1, max output 2048. Chat requests also disable thinking.

## Try it

The default local MCP server exposes two read-only tools: list files and read UTF-8 text. Its shared folder is **D:\Projects\bonfire-mcp**. This folder contains a welcome file and a copy of the bake-off report. Copy learning notes into this folder to make them available to Bonfire.

On a fresh setup, create the folder before starting. Set `BONFIRE_MCP_ROOT` in `backend/.env` to use another dedicated folder. Keep credentials and private configuration outside it.

Try: “List the shared workspace, find the model bake-off report, read it, and explain why Qwen was chosen. Use the real tools.”

Chat streams tool activity while it runs, then keeps a collapsible **Tools used** section with arguments and result previews. Tool activity survives conversation reloads. Tool calls and results are passed to the model in native assistant/tool messages within the current request. Saved conversation history retains answer text and an audit preview; a follow-up needing exact evidence should read the file again.

## Connect another local server

Copy `backend/mcp.example.json` to `backend/mcp.json` (Git ignored) and add a server entry. Use an installed executable and its arguments; Bonfire does not download or install servers automatically. Paths resolve from `backend` unless `cwd` is supplied. Each entry needs a unique short `name` and explicit `allowTools`. Set `enabled: false` to disable an entry. An empty `servers` array disables all MCP tools. Restart the backend after configuration changes.

Only explicitly allowed tools declaring `readOnlyHint: true` and no destructive hint are exposed. Tool names become `server__tool` to avoid collisions. Inspect and trust server code before allowing it: annotations describe intent and are not a process sandbox. Server processes receive a small SDK-provided environment plus the explicit `env` object, rather than all backend secrets. Do not put paid services in this configuration if you want to keep Bonfire free.

The implementation uses the [official MCP SDK](https://ts.sdk.modelcontextprotocol.io/client) with stdio transport. `/tools` shows the exposed schemas and server connection status; `/health` includes MCP status. A failed server is omitted so normal chat can continue. Restart the backend to reconnect a failed server. This first implementation supports text tools over local stdio; remote HTTP servers, MCP image/resource blocks, prompts, and write tools are not implemented. Hosted image search is available separately through the chat host.

## Limits

- 8 model turns and 10 tool calls per request; dependent calls execute in order.
- MCP initialize, discovery and calls have 15 second timeouts. Client disconnects abort inference and outstanding tool requests.
- Input arguments are validated with JSON Schema before execution. Unknown tools never execute.
- Tool evidence has size limits to fit the 8192 token model context. Responses exceeding the output token limit fail explicitly.
- Workspace reads reject absolute paths, parent traversal, links escaping the root, non-text files and files above 24 KB. Lists show up to 100 entries without recursing. Keep secrets outside the shared folder.
- Long text results are truncated to 6000 characters and marked as truncated; completed chat keeps only a 400 character result preview.
- Search still uses the separate Web toggle, Tavily/Brave chain, free-only confirmations and quota ledger. MCP tools do not use search credits.

## Useful next experiments

1. A read-only edge telemetry MCP server: compare GPU/CPU load, temperature and inference latency from real measurements.
2. A local SQLite tool server: let Bonfire look up experiment runs and calculate comparisons using bounded queries.
3. Local retrieval over your learning notes, returning short passages with file names and line numbers.
4. Route easy questions to Gemma and tool-heavy requests to Qwen; benchmark total latency including model switching before adopting it.
5. Replay the bake-off against actual MCP servers to compare protocol errors and task accuracy with the deterministic fixtures.
