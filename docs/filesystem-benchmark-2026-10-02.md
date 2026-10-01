# Filesystem and Bash benchmark — 2026-10-02

## Result

**File work became reliable on this corpus. Autonomous build-and-launch work still needs improvement.**

The final version passed **22/22 filesystem cases**, plus both stages of a backup/restore test. The full website request wrote the files but failed to start and verify the server. That makes the complete final run **24/25 tasks, 96%**. A separate assisted request successfully edited, launched and verified those same model-written files through Bonfire. The browser counter also works.

No code in the demo was hand-fixed by the test harness. Bonfire wrote the HTML/CSS/JS and Node server, then made the later loopback-binding edit using its native tools. The assisted request supplied the exact startup and verification commands; this is an assisted success, not an autonomous first-pass success.

## What ran

- Model: **Gemma 4 E4B IT Q4_K_M**, served by llama.cpp on the existing RX 6600 XT stack.
- Verified runtime: model file on D:, **8,192-token context**, one server slot, thinking off.
- Actual `/chat` requests, actual filesystem/Bash tools and disk verification; no mock model or LLM judge.
- Web off; no hosted inference, search credits, package installs or Docker.
- Isolated fixtures on D:. Existing user documents were not edited.
- Corpus: JSON reads, paged reads, exact file creation, precise JSON edits, repeated-value edits, Unicode/CRLF preservation, nested filename search, two-file updates, nested directory creation, missing-file honesty, and read-only access.
- Baseline: 11 cases once, two restore stages, website task, three plain-chat references.
- Intermediate: 11 cases twice, restore stages, website task, three references.
- Final: the same two-repeat corpus and extra tasks. All runs are sequential with the model already loaded. Cache misses, profile switches and background system activity can still affect latency.
- Backend regression suite: **88/88 passed**, including 25 filesystem/command/access tests.

## Metrics

| Metric | Baseline | Intermediate | Final raw-text version |
| --- | ---: | ---: | ---: |
| Filesystem corpus accuracy | 9/11 (81.8%) | 21/22 (95.5%) | **22/22 (100%)** |
| All tasks, including restore and autonomous website | 11/14 (78.6%) | 22/25 (88%) | **24/25 (96%)** |
| Corpus median completion | 14.46 s | 12.32 s | **12.80 s** |
| Corpus p95 completion | 72.15 s | 64.63 s | **35.46 s** |
| Corpus median visible-text TTFT | 10.70 s | 9.69 s | **10.12 s** |
| Successful tool executions / all returned results | 51/55 (92.7%) | 74/88 (84.1%) | **77/80 (96.3%)** |
| Recorded generation throughput, weighted | 32.66 tok/s | 33.15 tok/s | **33.13 tok/s** |

The final corpus's slowest case took **44.8 s**. Across all final tasks, median first tool activity was **2.34 s**, and median tool execution itself was **2.85 ms** (p95 **28.05 ms**). In the filesystem corpus, both rejected calls were expected reads of missing files. The other final-run tool error occurred in the failed website workflow.

Warm plain-chat references finished in a median **1.03 s**, with median visible-text TTFT **0.05 s**. These were three repetitions of the same short RAM question after the model was already loaded; they are not a cold-start latency measurement.

TTFT measures the first nonempty text shown to the user, including any pre-action narration. It can come before the requested work finishes. Time to first tool call is reported separately. Medians average the two middle values for even sample counts; p95 uses nearest rank. Throughput uses recorded generated tokens divided by recorded generation time and excludes single-token EOS timing artifacts. The baseline metrics writer missed some final-turn records before its asynchronous flush; baseline throughput is therefore descriptive, not a complete timing decomposition.

The corpus median improved by about **11.5%**, while reliability improved much more. This small, locally designed suite with only one or two repetitions does not establish general model reliability or a statistically significant speed gain.

## Coding demo

The task requested an embedded HTML/CSS/JS counter, a Node HTTP server, a Bash launch and HTTP verification.

| Attempt | Outcome | Completion |
| --- | --- | ---: |
| Final autonomous website task | Files written; wrong launch path, missing-package verification and context overflow prevented success | 84.3 s |
| Shorter natural-language follow-up | Repeated foreground launches timed out; recovery still failed | 142.9 s |
| Assisted commands and loopback-binding edit | Bonfire edited the server, ran Bash startup and returned `200 true` | **39.3 s** |

The assisted attempt used five native calls: directory list, file read, exact edit, background Bash startup, and Bash HTTP verification. Both commands returned exit 0. The page served exactly the generated `index.html`. The server was verified listening on **127.0.0.1:3011**. A separate browser check clicked Increment twice and observed **9 → 11**.

- Demo: [http://127.0.0.1:3011](http://127.0.0.1:3011)
- Saved assisted chat: [open in Bonfire](http://127.0.0.1:3000/?chat=1f2417b7-3ea3-464f-a5c2-78d53534e918)
- Files: `D:\Projects\bonfire-files-bench\2026-10-01T20-10-56-312Z-raw-text\counter-demo`

**FilePal** remains in the app with this demo folder and file/Bash tools assigned. Other guys received no new assignments. The demo server remains running; `server.pid` records its process ID. Failed verification scripts and traces remain for inspection, and are not used by the working page.

## Changes made during testing

1. Replaced display-numbered/JSON-escaped file bodies with raw text and separate line-range metadata. This removed the observed failure where Gemma copied display prefixes into edits.
2. Added explicit multiline-edit schema descriptions and actionable missing/ambiguous-match errors. Exact matching and current-file hashes remain required.
3. Clarified assigned-root file paths versus command working directories and returned command `cwd`.
4. Allowed an optional restore path, checked against the backup's actual path, after Gemma supplied that otherwise-redundant field.
5. Increased filesystem chats to 16 model turns / 20 calls so ordinary discovery and recovery have room.
6. Added one retry for an empty model response, followed by an explicit error if it remains empty.
7. Added optional Git Bash execution with timeouts, bounded output and a limited inherited environment. Timed-out results now explicitly say the foreground process was stopped and explain background-server startup. That last feedback improvement was regression-tested and included in the assisted run, not rerun over the whole corpus.

## Areas to improve next

**1. Managed processes.** A start/status/stop process primitive would avoid asking a small model to infer foreground/background lifecycle from shell commands. Current background servers require separate shutdown; Bash is not a folder sandbox and shell changes do not receive automatic snapshots.

**2. Artifact-aware context reduction.** Code-writing calls retain large source arguments, and recovery narration/error logs can fill the 8K context. Summarize completed writes by path/hash, retain small verification evidence and reload source from disk when needed. Raising the tool-step limit alone did not solve this.

**3. Fewer redundant rounds.** Gemma sometimes lists directories before reading a supplied filename, or repeats reads/edits. File tools take milliseconds; model planning, prompt processing and repeated turns dominate. Better prerequisite selection, selected-file context and retry/deduplication handling are worth measuring.

**4. Command verification.** A background shell launch can return exit 0 even when its child later fails. A verification program can also print an error and exit 0. Process readiness and HTTP assertions should be explicit primitives, rather than relying only on shell exit codes.

**5. Repeatability beyond this suite.** Add larger projects, unfamiliar file formats, changing files, longer histories and mixed MCP/filesystem assignments. Run the same corpus on Qwen for a direct reliability/latency comparison. The current suite proves useful local file work; it does not prove that Gemma can reliably run arbitrary computer workflows.

## Reproduce and inspect

From `backend`, with Bonfire running and the GPU free:

```powershell
npm test
npm run bench:files -- my-run 2
node bench/filesystem-report.js D:/Projects/bonfire-files-bench/<run>/results.json
```

Stop the current demo before rerunning: the corpus requires port 3011 to be free. It creates temporary folder assignments, guys and chats, removes only those entries afterward, and retains fixture files on D:.

Raw results are in these folders beneath `D:\Projects\bonfire-files-bench`:

- `2026-10-01T19-49-31-237Z-baseline/results.json`
- `2026-10-01T19-58-44-946Z-improved/results.json`
- `2026-10-01T20-10-56-312Z-raw-text/results.json`
- `summary.json`

The final demo directory also contains `recovery-results.json`, `assisted-results.json` and `browser-check.json`. Original traces are preserved. The report scorer corrects the initial missing-file rubric: proving absence with an empty directory listing is valid and does not require a failed read call.
