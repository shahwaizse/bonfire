# Loading tools on demand

## Why

Meg's Notion request failed before any inference or tool call because the model received roughly 20,333 tokens against an 8,192-token context. Assigning all tools had included every schema, including large editing and session tools, on every message.

## Examples studied

- [Anthropic Tool Search](https://www.anthropic.com/engineering/advanced-tool-use): defer most definitions, keep frequently used tools visible, and load a few matching schemas when the agent searches. Search can use lexical matching; embeddings are optional. Small catalogs may not benefit from the extra discovery turn.
- [Anthropic MCP progressive disclosure](https://www.anthropic.com/engineering/code-execution-with-mcp): expose names, descriptions and schemas at different levels of detail instead of inserting everything into the prompt. Keep intermediate evidence bounded.
- [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode-mcp/): expose search and execution interfaces to a large API rather than all endpoint definitions. Bonfire adopts the discovery principle while retaining native tool calls, so Gemma does not need to generate orchestration code.

These sources describe patterns and their own measurements. They do not establish Gemma's accuracy or performance.

## Bonfire implementation

`DiscoverableTools` wraps the already permission-scoped registry per chat request. It never searches tools belonging to another guy or tools not enabled in connector settings.

- Small catalogs retain their ordinary native schemas.
- Remote services, catalogs above ten tools, and bulky catalogs use lazy loading.
- The initial set contains compact host tools, `search_tools`, and up to two candidates ranked against the current request. An assigned prerequisite explicitly named by the provider can also be loaded.
- Search indexes tool names, descriptions and argument names, with action synonyms and deterministic ordering. General search is preferred over agent/session search when those specialized subjects were not requested.
- `search_tools` loads at most three matches. Each inference turn refreshes the active schema list. Search returns metadata rather than duplicating schemas in tool results.
- Searches rotate the active working set rather than accumulating tools indefinitely. A previously used tool can be loaded again by exact name.
- Schema annotations are shortened; property names, required fields, enums, references and validation constraints remain. Actual dispatch still validates against the original server schema.
- The ordinary working set targets 2,400 JSON-schema tokens. An exact-name search can load a single larger tool up to a 4,200-token working set. The formatted-prompt check remains the final authority.
- Every inference request uses llama.cpp's `/apply-template`, `/tokenize` and reported context size to reserve output space before inference. If necessary, old conversation turns are dropped and tool evidence is explicitly marked as shortened. Call/result pairs, current request and system instructions are retained. A request that still cannot fit gets an actionable error rather than an opaque HTTP 400.

The model's content instructions and saved tool assignments are unchanged. Discovery is a local host operation and consumes no paid API credits. It appears in the normal tool activity trace.

## Token measurement

For the request “hi, can you find the web3 page in my notion and give a summary of it?”, using Meg's current assigned catalog with Web off:

| Prompt construction | Formatted input tokens, including a 32-token margin |
| --- | ---: |
| All 41 assigned tool definitions | 20,364 |
| Discovery plus relevant working set | 2,099 |

The new working set is `search_tools`, `search_images`, Notion search, fetch, and tool-access discovery: about 90% fewer input tokens. Counts were obtained by formatting and tokenizing the prompt; no response was generated and no Notion page was fetched for this measurement. The earlier live failure was 20,333 tokens; the small difference reflects the conservative margin and reconstructed request.

## Limits

Lexical search can miss unusual wording; the agent can search again using the service/action or an exact name. Discovery may add a model turn when the initial shortlist is insufficient. A single schema that exceeds the larger working-set allowance requires a narrower provider schema. Token reduction does not establish successful end-to-end tool use. Existing per-request call and turn limits still apply.
