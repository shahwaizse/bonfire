# Search tool selection experiment - September 30, 2026

## Configuration

Real Qwen3.5-9B Q4_K_M inference on Bonfire's RX 6600 XT using llama.cpp native tool calls, thinking off, temperature 0.1, 8192 context. The catalog contained image search, web search, page reading and two existing read-only MCP tools. No image routing or forced web prefetch was used during the experiment.

22 cases repeated twice (44 tasks). Provider and MCP outputs were deterministic fixtures: this evaluates tool selection, not factual freshness or real search relevance. Four calls/turns and 120 seconds were allowed per task. Run from backend with `node bench/search-routing.js`; raw answers and traces are saved in the ignored `bench/results/search-routing.json`.

## Results

| Expected choice | Correct selection | Completed with expected choice |
| --- | --- | --- |
| Web search | 13/18 (72%) | 12/18 |
| Image search | 6/6 | 6/6 |
| No tools | 16/16 | 16/16 |
| Supplied page reading | 2/2 | 2/2 |
| MCP file listing | 2/2 | 2/2 |

The model skipped web search for the exact latest-Anthropic question twice, the September-2026 Node LTS question twice, and a current local-model recommendation once. These runs answered from stale internal knowledge. One Brave pricing run selected web search correctly but exhausted the four-turn budget while trying to improve generic fixture evidence. That is counted separately from missed tool selection.

Image cases included Megan Fox, auroras over Norway and a contextual red-carpet follow-up. Topic switching from pictures to an Anthropic question chose web rather than images in both repetitions. Timeless MCP explanations, coding, arithmetic, translation and an explicit offline request made no unnecessary calls.

## Implementation decision

Image search is now an agent tool, with no Images button or sticky mode. The host neither forces the image call nor writes the final response. Native results drive the gallery; Qwen supplies the introduction.

Keep Web as a reliable manual search override. Automatic selection missed 5/18 web cases despite clear runtime/tool instructions, including the user's exact question. Web on retrieves evidence before generation and permits follow-up agent searches; image intent only suppresses this text prefetch. Revisit automatic web selection after a model change using the same cases and more repetitions.

Small samples and generic fixtures limit these findings. Six image successes do not establish universal routing reliability. Tests do not measure citation accuracy, malicious pages, general reasoning or image understanding.

## App validation

52 backend tests passed; production frontend build passed. All 16 selected desktop/mobile browser tests passed, including live Qwen image search and MCP calls. Four gallery/tool-detail cases were rerun after adding reply-before-gallery and no-duplicate-sources assertions; all passed.

A live two-message conversation requested Megan Fox pictures with Web off, then asked the user's exact latest-Anthropic question with Web on. The first request made a native `search_images` call; the follow-up retrieved four web sources and saved no images. This validates routing and persistence, not the factual correctness of every generated claim. Only test-created conversations were deleted; existing user chats were preserved. Free-only provider settings and shared caps remain in force.
