# Little guys

A little guy is a saved agent profile: name, short tagline, instructions, modular mascot recipe, allowed tools and allowed app IDs. One guy owns a chat. The left sidebar groups chats by guy; opening an existing conversation restores its guy. Editing a profile applies on the next message. Deleting it preserves old chat history in a retired-guy group but blocks continuation.

## Your crew's sidebar

- Click a guy's heading to expand/fold its chats. Folded groups show only the heading; expanded groups show a simple list with rename/delete menus.
- Click **+** next to a guy to start a chat assigned to it. The top **New chat** always starts a Bonfire chat. New-chat actions are disabled during generation; existing chats remain browsable.
- **Bonfire** contains chats with no agent. Its **+** explicitly starts a general chat.
- Collapse the sidebar with the top icon for a narrow mascot rail. Click a mascot to expand the sidebar and reveal its group.
- Sidebar width and folded groups are saved in browser local storage. A bare URL opens Bonfire. Selecting or creating a saved conversation places its existing UUID in `?chat=...`, which restores its messages and assigned guy on reload and supports browser Back/Forward. An unsent new chat returns to Bonfire on reload.
- The mobile menu opens the full sidebar. Creation and crew settings are available in either width and on mobile.
- A guy's **...** menu opens its editor directly. **Crew & app launchers** opens the full manager.

## Make one

1. Click **Create little guy** at the bottom of the left sidebar; it opens the creator directly.
2. Describe its job. Choose body, palette and vibe, or leave the visual choices as Surprise me.
3. Let the local model make a guy. Real native `create_little_guy` arguments choose from predefined assets; raw SVG/HTML is never accepted. A failed/missing call reports an error rather than inventing an AI-generated result.
4. Review/edit instructions and select tools by service. Groups start collapsed; their checkbox assigns all enabled tools, and expanding a group lets you choose individual tools. Assign apps for app launchers.
5. Save and click Chat. The new guy can use its checked tools plus default web search and page reading. Web starts off in new chats; click the globe to enable or disable searching.

You can also configure the fields manually. The mascot recipe offers five bodies, four eye styles, four mouths, five accessories, four patterns and five palettes. An integer seed adjusts tints and pattern placement. Recipes persist in SQLite. The SVG renderer consists of static component assets and numeric geometry; Qwen cannot inject markup. Motion respects reduced-motion preferences.

Keep instructions short and direct: a topic or job, a response style, and when to use tools is enough. Each chat places the selected guy's identity and instructions first, rather than introducing a general Bonfire persona first. New AI-generated profiles preserve your original brief alongside the model's suggested behavior so paraphrasing cannot erase it. Existing saved profiles are not rewritten. See the [agent research and Meg diagnosis](agent-reliability-2026-10-01.md) for measured behavior and remaining limits.

Remix mascot preserves existing name, instructions and permissions. Initial generation creates a draft with zero permissions. No cloud inference, image service, extra model download or paid asset is involved.

## Launch apps

In App launchers, add an installed local `.exe` or a digits-only Steam app ID. These are owner-configured targets, never model-provided paths/commands. Notepad is available by default on Windows. Select `desktop / list apps` and `desktop / launch app` for your gaming guy, then check its allowed apps.

Example instructions: Be concise and playful. When I ask to open an assigned app, discover its ID if needed, call the launch tool, and report the actual result. Never claim the window opened just because the launch request was sent.

Try "Open Notepad" or "Launch Tekken 8". There is no second confirmation for assigned apps. Normal Bonfire chat has no desktop tools. Duplicate launch requests for the same app in one message are blocked; at most three distinct launches are allowed per message. Cancelling chat cannot undo a launch already sent. Application behavior, Steam sign-in and OS prompts can still affect whether it opens.

The local starter guy GamerPal was created through Qwen's native mascot call. On the current workstation, Notepad and Tekken 8 were configured using the installed executable/default and Steam manifest. No apps were launched during feature preparation.

## Watch the machine

Assign `machine__get_machine_snapshot` and `machine__get_inference_stats` to a little guy. Ask "Give me a machine report: GPU load and temperatures, memory usage, and recent inference speed." These are read-only MCP tools; normal Bonfire chat does not receive them automatically. No external service, credits, model download or monitoring installation is required.

The local starter watcher **ChipSentry** was created by Qwen's native mascot call: a teal robot with an antenna and striped body. It is assigned only these two tools. Its first saved chat report used both real tools and reported GPU temperatures and recorded inference speed while correctly leaving CPU temperature unavailable.

The fixed Windows probe reads AMD GPU activity, edge/hotspot temperatures, fan RPM and core clock through the installed driver's [ADL PMLog API](https://gpuopen-librariesandsdks.github.io/adl/group__OVERDRIVE8API.html). This older query API works for on-demand snapshots; AMD recommends shared-memory reads for newer integrations. Windows counters supply per-engine activity and per-adapter dedicated VRAM usage; CPU load and RAM come from CIM. Engine activity is not summed across unrelated engine types, and Windows adapter IDs are not guessed to match AMD adapters on multi-GPU systems. AMD and Windows readings use different sampling windows and can differ.

Unavailable readings remain `null`. CPU package temperature is read only if a compatible LibreHardwareMonitor sensor is already exposed. This workstation exposes GPU edge/hotspot readings, but no CPU temperature. ACPI thermal zones are not presented as CPU readings. Non-Windows hosts report the hardware probe as unavailable; recorded inference timings remain usable.

A persistent Windows helper samples every five seconds while the machine MCP server runs. The first sample took about 1.27 seconds in the optimization checks; subsequent tool calls reuse the sample. Each reading has a timestamp and age; samples older than 15 seconds are rejected. The model pauses while calling tools, so a snapshot may capture a different workload from text generation. This version has no background alerts or temperature history.

`machine__get_status` combines a compact hardware summary with recorded inference speeds. It is available when explicitly assigned, or derived when a guy already has both original read permissions. The detailed tools remain available. The compact combined response avoids sending a long timing history back through the model for a simple status question.

Inference stats retain the last 30 model turns, including tool planning and mascot creation. The tool returns up to ten recent turns with llama.cpp's generation tokens/sec, generated token count, prompt processing speed, first output latency and wall time. First output includes a tool-call fragment, not necessarily visible answer text. The reported aggregate weights completed turns by generation duration. It is recorded request performance, not a new benchmark or instantaneous GPU speed. Missing timings are unavailable; character counts are never substituted for token counts. No prompts or answers are stored in this timing file.

Storage defaults to ignored `backend/data/inference-stats.json`; `BONFIRE_INFERENCE_STATS_PATH` can override it, and the backend forwards the same resolved path to the MCP server. Disable the built-in tools with a `machine` entry marked `enabled: false` in private `mcp.json`, then restart the backend. The probe runs only the fixed repository script; model-provided commands and driver setting controls are not accepted.

## Tools and enforcement

The MCP configuration is the outer server allowlist. A guy's tool/app selections narrow it further; they never expand it. The built-in desktop MCP server declares launch as non-read-only and explicitly opts in with `allowSideEffects: ["launch_app"]`. Other servers still default to read-only tools unless the owner separately opts in exact non-destructive side effects.

The native catalog is filtered per request. Calls are checked again before dispatch; launch IDs must be assigned. Search prefetch/page reads respect the same permissions. Web is disabled in the UI when not assigned; image/page tools remain independent when assigned. MCP app listing exposes only the guy's assigned apps. Removal of an app revokes it from saved profiles, and removes launch permission if no apps remain.

Instructions control behavior, not authorization. They cannot make arbitrary files, shell commands, tools or executables available. Read-only MCP annotations are not an OS sandbox; trust installed server code before allowing it.

## Storage and current scope

- Profiles: `little_guys` table in ignored `backend/data/app.db`.
- Conversation binding: nullable `conversations.agent_id`; existing chats remain normal Bonfire chats.
- Apps: ignored `backend/data/desktop-apps.json`. `BONFIRE_APPS_PATH` can override this file; the backend forwards that path to the built-in server.
- Per-request tool-loop limits, validation, search quota accounting and saved activity traces remain in force.
- No multi-agent orchestration, background schedules, remote HTTP MCP, general shell execution, app-closing controls or per-guy model switching in this first version.

Local inference is used for mascot creation and chat. Normal selected hosted search tools still contact Tavily/Brave under the existing free-only constraints.

Web search and page reading are included for every existing and new guy. Other tools, including image search, connectors and app launching, retain explicit assignment. The globe button remains available for every guy. It starts off on page load and resets off for each new chat; an active globe indicates web search is enabled.
