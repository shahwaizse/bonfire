# Agent reliability research and Meg diagnosis

October 1, 2026. Sources are public official documentation and OpenAI's published Codex starter prompt, plus Bonfire's actual code, saved Meg profile and conversations. This is not a reconstruction of private Cursor or Claude Code system prompts. A documented mechanism is not proof of its contribution to a product's measured reliability.

## What the larger agents actually provide

| Product / published source | Relevant practices | Bonfire adaptation |
| --- | --- | --- |
| [Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) | Published starter prompt describes gathering context, completing work, using suitable tools, and validating outcomes. Tool formats are aligned with model training; prompt changes are evaluated. The guide is model-specific. | Clear job and completion criteria; native tool schemas; small reproducible evaluations. Copying its entire coding prompt into Gemma would add irrelevant tokens. |
| [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | Specialized instructions, configurable/inherited model settings, tool configuration, separate threads and summaries. Isolating noisy work helps preserve useful context. | A little guy should receive a complete role, relevant tools and compact task state. A child can use the same model as a parent; delegation does not intrinsically reduce capability. |
| [Claude Code architecture](https://code.claude.com/docs/en/how-claude-code-works) | Gather context → act → verify loop; tool output feeds the next decision. Local session persistence, context compaction and persistent instructions support continuity. | Preserve structured evidence and known IDs across turns, rather than retaining only rendered prose. Show meaningful progress and distinguish a tool dispatch from a verified result. |
| [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) | A custom agent has a defined prompt, tools, model and task. Ordinary custom subagents receive their own prompt and environment; forks share parent context/prompt. These are different mechanisms. | Make a guy's identity primary. Define what its tools can do and what completes its job. Users can start with a short description; the application supplies the surrounding mechanics. |
| [Cursor subagents](https://cursor.com/docs/subagents) | Separate context for noisy exploration, shell and browser work; explicit task handoffs; specialized prompts/tools/models; concise results returned to the parent. | Later, one guy can hand a bounded task to another with the objective, relevant evidence and expected result. On this GPU, execute model work sequentially rather than promising parallel inference. |
| [Cursor rules](https://cursor.com/docs/rules) | Persistent instructions applied at the start of context; focused, actionable rules with concrete examples and scoped activation. | Pin owner intent on every request. Add one useful example when a short instruction is ambiguous; avoid expanding every guy into a giant system prompt. |
| [Claude Code skills](https://code.claude.com/docs/en/skills) | Workflow bodies and supporting references load when needed, instead of placing everything in every prompt. | Optional little-guy recipes such as “find app ID → launch → report” and “read status → summarize”. Load a matching recipe only for that task. |

My inference: their usefulness comes from model capability plus coherent instructions, tools, context and execution infrastructure. A subordinate agent is a separate model session with a scoped job, not an inherently weaker kind of model. Their documentation does not establish that every subagent is equally capable of every parent task.

Bonfire already has native tool calls, exact schema validation, per-guy catalogs, tool results in the current inference loop, bounded context, read-only parallel dispatch and a local inference queue. The biggest remaining gaps are intent precedence, continuity of structured task state and evaluations of ordinary conversation behavior. More orchestration alone would not fix these.

## Meg: the actual evidence

Saved profile:

```text
Name: Meg
Tagline: shows Megan Fox pictures
Instructions: Always talk about Megax Fox, and if prompted, show images of Megan Fox.
Tools: search_images, search_web
```

The saved spelling is `Megax`, but the tagline and second clause identify Megan Fox. No spelling correction or profile rewrite was needed for this experiment.

The older `hi` conversation contains:

- `hi` → “Hi! How can I help you today?”
- `weather's nice isn't it?` → a generic weather acknowledgement.
- `hmm, what do YOU want to do?` → a generic no-personal-preferences reply with unrelated activity suggestions.
- An explicit Megan Fox image request did invoke image search.

The later sexual-health chat also used generic assistant behavior. The saved transcript alone cannot identify every prompt/runtime version used at the time, so it is evidence of the behavior rather than proof of one historical cause. Model-trained refusals are a separate issue from role adherence.

Code inspection confirms that the backend loads the conversation's `agent_id`, retrieves the guy and passes its instructions to prompt construction. The profile is not missing, and ordinary history trimming does not remove the system message.

The conflict was visible in the current prompt: it introduced **Bonfire, a general-purpose assistant** before introducing Meg and her custom instructions. In fresh local probes the model explicitly called the custom role a “little side note” and called itself Bonfire. It answered an unrelated RAM question without mentioning the assigned topic. That supports identity competition as a current contributing cause; it does not prove that wording explains every historical refusal or mistake.

There is also a creation weakness: the model generates an `instructions` string from the user's brief, and the original brief was not preserved separately. The model can omit a condition while generating the profile. Meg's currently saved instruction already contains the requested behavior; her observed failure is not explained by a missing topic in that field.

## Small fixes applied

1. Guy chats introduce **the selected guy first**, with the owner's instructions. Plain Bonfire chats retain the general identity.
2. A short shared instruction applies the role to greetings and follow-ups, including conversations with older generic replies. There is no per-Meg hardcoded topic or hidden expanded Meg prompt.
3. Tool guidance connects calls to the current request instead of treating an available tool as an automatic task.
4. Newly generated profiles preserve the original brief verbatim alongside suggested behavior. Existing profiles and their conversations remain unchanged.

These are job/persona and tool-protocol instructions. No content refusal policy, classifier or new permission confirmation was added.

## Local checks and limitations

`backend/bench/guy-instructions.js` runs Gemma 4 E4B Q4_K_M on port 8082 with seed 42, thinking off, native tool calls and deterministic image fixtures. It creates no conversations, spends no search credits and launches no apps. Raw results are on D::

- `D:/Projects/bonfire-latency/guy-instructions-comparison.json`
- `D:/Projects/bonfire-latency/guy-instructions-final.json`

Eleven scenarios cover eight Meg requests (greeting, weather, initiative, capabilities, off-topic RAM, stale generic history, implicit pictures, picture follow-up), an Urdu-only guy, a `BEEP`/one-sentence guy and plain chat.

- Before: **9/11** passed the simple topic/style/tool-query criteria. The RAM request dropped Meg's topic; the formatting guy reached its output limit.
- Final: **11/11** passed those same criteria. The custom formatting reply was `BEEP RAM is fast, temporary memory for your computer.` Meg's greeting began by identifying herself as Meg; initiative focused on Megan Fox. Picture queries used Megan Fox, including red-carpet follow-up.
- Important remaining defect: one stale-history weather case made two unrequested image calls. Thus **10/11** met both the basic criteria and the additional expectation of no tools on conversational requests. The first candidate made unnecessary calls in more cases and was refined.
- These are one-pass seed-42 samples, not a broad guarantee. Mentioning the correct topic is a weaker criterion than a human judgment of useful conversation. The image fixture intentionally returns a small result; final prose can include invented gallery markup. Real production image results include more explicit gallery instructions. No live-provider gallery quality claim is made.

Re-run against the installed prompt with:

```powershell
cd backend
node bench/guy-instructions.js current D:/Projects/bonfire-latency/guy-instructions-next.json
```

The comparison mode contains the first experimental prompt and captures whatever installed prompt is present as its baseline. It does not restore the historical baseline automatically; the archived comparison file preserves that original prompt.

## Next UX improvements, in order

### 1. Preview a guy before saving

A **Try your guy** panel with a greeting, a normal task and a tool task would expose generic replies during creation. Show the owner brief, suggested behavior and available tools clearly. A generated interpretation should be reviewable; extra permissions remain the owner's choice. An example reply can clarify ambiguous style better than a large prompt.

### 2. Separate job, style and tool triggers

Let someone write “always talk about Megan Fox; show her pictures when I ask.” The app can suggest editable fields: topic Megan Fox, friendly tone, image search on picture requests. Keep the original sentence as the authority. This can resolve ambiguous phrases such as “if prompted” without silently broadening the job. Avoid building a hidden prompt compiler that invents preferences.

### 3. Preserve useful task state

Save a bounded set of subject/IDs/evidence with provenance and timestamps. Current follow-up history keeps prose and short activity previews; exact native tool transcripts are only present during the active request. A later “more like these” or “launch that again” can lose the useful state. Summaries should retain decisions and unresolved work, rather than generic chat filler. Editable per-guy memory can follow later.

### 4. Make capability and progress legible

Show when Web is unavailable even though the profile selected its tool. Currently `search_web` additionally requires the chat Web toggle; assigning the tool alone does not expose it on every turn. Keep progress descriptive: selecting tool, awaiting tool, writing answer. Tool traces should explain actual results, missing readings and errors.

### 5. Add small skills and recoverable steps

Reusable procedures can teach discovery before a dependent call, one recovery on a genuinely transient read failure, and completion checks. Do not retry a successful wrong call or re-execute a completed launch to repair an empty answer. A host-side answer recovery could reuse the existing results. Measure added latency and retain concise outputs.

### 6. Delegate later

A request like “ask ChipSentry whether I have GPU headroom, then ask GamerPal to open Tekken” is a useful later demo. Handoff needs an objective, relevant state, available tools and a clear return result. Keep one inference slot and schedule the turns; an 8 GB card does not acquire extra compute from multiple agent labels. Establish reliable single-guy behavior first.
