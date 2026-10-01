# Bonfire harness improvements

## Findings from the latest FilePal chats

The user asked Bonfire to stop its counter app. It ran `ps aux | grep 'node server.cjs'` four times across two requests, then tried the unavailable `lsof -i :3011` twice. Empty failed queries were treated as possible evidence of shutdown. The user confirmed the app remained reachable.

Earlier tool results already mentioned `server.pid`, the working directory and a successful HTTP check. Subsequent requests supplied ordinary conversation text to the model, but did not restore saved tool evidence. There was no managed process lifecycle either.

These are shared runtime failures. FilePal's instructions and profile were not changed.

## Structure

| Layer | Responsibility | Changes |
| --- | --- | --- |
| Little guy | Purpose, personality, tools and folder grants | No special FilePal behavior |
| Capability adapter | Validate inputs, execute actions, return measured results | Managed command lifecycle, specific validation errors, OS-aware failure feedback |
| Shared execution loop | Calls, error recovery and evidence | Suppress unchanged permanent failures; permit one recognized transient retry |
| Shared conversation context | Restore compact observations and configuration | Permission-filtered tool evidence, deduplication, legacy recovery, configured folder IDs |
| User-facing result | Distinguish attempted actions from verified outcomes | Process running/stopped fields and logs; HTTP checks stay separate |

### Managed commands

The existing `files__run_command` grant covers four modes:

- `run` (default): bounded foreground Bash execution.
- `start`: persistent launch, returning a stable `process_id`, OS PID, working directory and log tail.
- `status`: inspect one managed process or list recent launches for the current agent and folder.
- `stop`: stop the managed process tree and check the original process identity is no longer running.

`path` defaults to the assigned folder root. `command` is needed for run/start; `process_id` is needed for stop. These are Bonfire-generated IDs. Every little guy with the command grant gets these capabilities without selecting additional tools.

Private records and logs default to `D:/Projects/bonfire-processes` (`BONFIRE_PROCESS_DIR`) and survive backend restarts. Windows process creation time is checked alongside PID to reject recycled PIDs; Linux uses `/proc` start time. Records are scoped to their owning agent and assigned folder. Commands retain the existing full-account shell privileges; they are not a folder sandbox.

Bonfire supplies its actual OS and shell, plus the current assigned folder names, IDs, roots and access modes. A user should not have to look up internal folder IDs. For older unmanaged launches, the model can inspect PID/log files and use native Windows process/port commands.

### Tool evidence

`tool-evidence.js` creates compact observations from file and command results. Read bodies and write/edit payloads are omitted. Paths, hashes, backup IDs, exit status, short command output and managed process IDs are retained with existing tool activity; no database migration is needed.

The next request restores up to ten distinct observations within 4,200 characters, filtered by currently allowed tools and assigned folders. Complete legacy summaries can be recovered; truncated JSON is discarded. Observations are labelled historical: saved hashes and running states need rechecking before action.

This is capability-based compaction, independent of agent names. Other adapters can supply explicit compact evidence through the same loop event and context path.

### Error handling

Identical arguments with reordered JSON keys count as the same call. Repeating a permanent failure returns recovery feedback without executing it again. Recognized transient connection/rate-limit errors permit one unchanged retry for read-only tools. Mutation failures need inspection before another attempt, since a failed response can hide a completed action. This is a bounded heuristic, not a complete provider error taxonomy.

Validation errors name the missing/invalid field. Missing commands, foreground timeouts and empty failed process queries get distinct feedback. Exit code zero alone does not prove HTTP readiness or shutdown.

## Validation and iteration

The initial backend suite passed **94/94** tests, including process record persistence, logs, stop verification, cross-agent ownership rejection, early startup failure, evidence scoping, legacy recovery, repeated-call suppression and transient retry.

The real-model corpus uses two temporary profiles with different short instructions. Both must start a fixture server, then stop it on a follow-up turn. HTTP is checked independently.

1. First trial: **0/2** complete lifecycles. Both started successfully but omitted `path` for stop/status. Fixed the unnecessary required argument and generic validation feedback.
2. Second trial: **1/2** complete lifecycles. The second profile asked the user for an internal folder ID instead of discovering it. Added actual assigned folder configuration to the shared runtime context.
3. Third trial: **2/2** lifecycles worked. One profile still skipped the requested HTTP verification, claiming it needed a browser. Added shared guidance that HTTP checks can use built-in Node fetch without a browser. The corpus now scores model-side verification separately from independent HTTP checks.
4. Final trial: **2/2** complete tasks passed, including model-side HTTP content verification, managed shutdown on the follow-up turn, and independent checks that both endpoints became unreachable.

| Short profile | Start + HTTP verification | Stop follow-up | Result |
| --- | ---: | ---: | --- |
| General file/command helper | 14.7 s | 15.0 s | Pass |
| Friendly computer-task robot | 23.4 s | 19.1 s | Pass |

Final backend regression suite: **94/94 passed**. Final real-model trace: `D:/Projects/bonfire-harness-bench/2026-10-01T21-06-03.844Z/results.json`. This is a two-profile smoke check, not a broad accuracy or latency benchmark. The earlier 0/2 → 1/2 → 2/2 iteration records are useful failure evidence, not a statistically controlled performance comparison.

Reproduce with `node bench/managed-command-app.js` from `backend`. Detailed events and timings are retained under `D:/Projects/bonfire-harness-bench/`. The script stops its managed processes and removes temporary configuration/chats.

## Remaining improvements

- Old `nohup` launches are not automatically adopted. Managed status only lists recorded launches; old apps require native inspection or PID files.
- Log tails are bounded for inference, but log files are not rotated yet.
- Process status does not prove HTTP readiness or that every independently detached descendant exited. Verify the requested endpoint separately.
- Large coding tasks still need compaction of completed write payloads and a durable artifact/task ledger. This patch does not claim to fix the earlier autonomous coding benchmark.
- Evidence compaction currently covers native filesystem/command results. Add explicit connector result schemas rather than blindly retaining arbitrary MCP output.
- Expand evaluation to multi-file changes, stale hashes, failed launches and shutdown after backend restart. Measure execution correctness separately from end-to-end task completion across ordinary little guys.
