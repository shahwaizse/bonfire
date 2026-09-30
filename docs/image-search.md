# Picture requests and inline image search

Ask "bring up pictures of Megan Fox" or "show me photos of auroras." Qwen chooses and calls `search_images` through the same native tool loop as MCP. It resolves follow-ups from chat context and receives actual results before answering. Image search works with Web off. There is no sticky Images mode and no canned host reply.

The reply appears above the gallery, with tool details collapsed underneath. Each thumbnail opens its original image and each tile has a source link; image metadata does not add a duplicate Sources footer. Galleries and native tool traces survive conversation reloads. Broken thumbnails retry the original URL, then show a placeholder with links available. Public image hosts receive no referrer. Qwen receives metadata, not image pixels.

Tavily's main image results take priority over incidental images extracted from pages. Obvious SVGs, favicons, wordmarks and static page assets are filtered unless the query asks for logos or icons. This is a heuristic, not a guarantee that every thumbnail depicts the requested subject.

## Web decision

The Web toggle remains an explicit search override. With Web on, the host retrieves text evidence before generation; Qwen can make follow-up `search_web` and `read_webpage` calls. Picture requests skip the text prefetch and leave image selection to Qwen. With Web off, image search and supplied-page reading remain available, but general text search is disabled.

The [routing experiment](search-tool-routing-2026-09-30.md) explains why automatic web selection is not enabled by default.

## Providers and free usage

Image search uses the same Tavily → Brave chain, private backend keys, free-only confirmations, and persistent monthly quota ledger as text search. Web and images share the per-provider counters. Tavily stays on `basic` with automatic parameter selection and AI image descriptions disabled; no advanced search upgrades are requested. Brave is used when Tavily is unavailable, exhausted, or returns no images. If both are unavailable, Bonfire explains the failure without inventing a gallery.

The [Tavily search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) supports `include_images` and source-linked result images. The [Brave image API](https://api-dashboard.search.brave.com/api-reference/images/image_search) returns original image URLs, thumbnails, and source-page URLs. Its [Search plan documentation](https://api-dashboard.search.brave.com/documentation/resources/help-feedback) includes image search in the same plan. Existing provider-side billing restrictions remain required; Bonfire does not enable billing or top-ups.

## Web/tool fix

The previous chat failed with HTTP 400 because the Qwen template requires a single system message at the beginning, while Bonfire added web evidence as a second system message. Runtime instructions and retrieved evidence are now assembled into one initial system message. No old chat messages were rewritten.

Tool permissions describe external actions and filesystem access. They do not disable ordinary text/code generation. The runtime prompt now describes hosted web and picture features separately from the MCP file-tool catalog. No code-specific safety restrictions were added.

The Downloads folder remains outside the configured shared MCP root. That is a configuration boundary rather than a broken list tool. To expose another folder, configure a separate trusted read-only MCP server/root; the default remains `D:\Projects\bonfire-mcp`.

## Checks

Backend tests cover native tool schemas, cumulative galleries, citation numbering, limits/cancellation, provider fallback, free quota accounting, logo filtering and one initial system message. Desktop/mobile browser checks cover galleries, source links, reloads, absence of an Images button, real image-tool execution and MCP execution. See the routing report for current validation results.
