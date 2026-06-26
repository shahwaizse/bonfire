# Setup Log

Chronological log of every command, error, and fix made while building this project.
Format: `[PHASE] timestamp — action — result`

## Phase 0 — Directory structure

- 2026-06-25 — Created directories: `models/`, `backend/`, `frontend/`, `infra/`, `scripts/`, `vendor/` under `C:\Users\mshah\local-nsfw-llm` — OK
- 2026-06-25 — Created this `SETUP_LOG.md` — OK

## Phase 1 — Dependency checks/installs

Initial check (`winget --version`, `git --version`, `python --version`, `node --version`, `npm --version`, `cmake --version`, `ninja --version`, `docker --version`, `vulkaninfo --summary`):

- winget v1.28.240 — present
- git 2.54.0.windows.1 — present
- node v24.13.1 / npm 11.8.0 — present
- python — NOT FOUND
- cmake — NOT FOUND
- ninja — NOT FOUND
- docker — NOT FOUND
- vulkaninfo — present, detected `AMD Radeon RX 6600 XT` (discrete GPU, driver 26.6.2) — no Adrenalin driver update needed.

Installed via winget (`winget install -e --id <id> --accept-package-agreements --accept-source-agreements`), full transcript in `install_log.txt`:

- `Python.Python.3.12` → 3.12.10 — Successfully installed (exit 0)
- `Kitware.CMake` → 4.3.3 — Successfully installed (exit 0)
- `Ninja-build.Ninja` → 1.13.2 — Successfully installed (exit 0); note: PATH was updated by installer, required opening a fresh shell / re-reading PATH from registry for `ninja`/`cmake` to resolve.
- `KhronosGroup.VulkanSDK` → 1.4.350.0 — Successfully installed (exit 0). Needed for `glslc`/shader compilation when building llama.cpp with `GGML_VULKAN=ON` (separate from the Vulkan runtime/driver, which was already present).
- `Microsoft.VisualStudio.2022.BuildTools` (C++ workload via `--override`) — in progress at time of writing.
- `Docker.DockerDesktop` — queued after Build Tools.

## Phase 2 — Clone llama.cpp

- `git clone https://github.com/ggml-org/llama.cpp` (full clone) — **FAILED**: `error: RPC failed; curl 18 transfer closed with outstanding read data remaining` / `fatal: early EOF`. Cause: heavy concurrent bandwidth usage from the simultaneous model download (~4.9GB) and winget installs (VS Build Tools, Vulkan SDK) starved/destabilized the git HTTP transfer. Git automatically removed the partial directory on failure.
- Fix: set `git config --global http.lowSpeedLimit 1000` / `http.lowSpeedTime 60`, and retried as a shallow clone: `git clone --depth 1 https://github.com/ggml-org/llama.cpp`. Full history isn't needed to build, and a shallow clone is far less data to transfer, reducing the odds of hitting the same transient network failure under contention.
- Shallow clone succeeded on retry.
- `Microsoft.VisualStudio.2022.BuildTools` (C++ workload) finished installing — Successfully installed (exit 0). Took ~35 minutes under heavy concurrent bandwidth usage (model download + Docker Desktop queued); confirmed via `Get-Process` that `vs_BuildTools`/`vs_setup_bootstrapper` were actively consuming CPU throughout, i.e. not stuck on a hidden UAC prompt.
- `Docker.DockerDesktop` install started afterward (still running at time of writing).
- Located MSVC toolchain via `vswhere.exe -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath` → `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`, confirmed `VC\Auxiliary\Build\vcvarsall.bat` exists.
- First build attempt **FAILED** at CMake configure: `CMake Error: Could NOT find Vulkan (missing: Vulkan_LIBRARY Vulkan_INCLUDE_DIR)`. Cause: the `VULKAN_SDK` machine environment variable (set by the winget Vulkan SDK installer) was never loaded into the current shell session/process — `[System.Environment]::GetEnvironmentVariable("VULKAN_SDK","Machine")` confirmed it was set to `C:\VulkanSDK\1.4.350.0` at the machine level, but `$env:VULKAN_SDK` in the running shell was empty.
- Fix: removed the partial `vendor/llama.cpp/build` directory, explicitly set `$env:VULKAN_SDK` (and re-pulled `PATH`) from the machine environment before invoking `vcvarsall.bat`/cmake, and re-ran:
  `cmd /c "set VULKAN_SDK=... && call vcvarsall.bat x64 && cmake -B build -G Ninja -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release -j"` (see `vendor/llama_build_log.txt`).
- Build succeeded (766/766 steps, exit 0). `llama-server.exe` located at `vendor/llama.cpp/build/bin/llama-server.exe`.

## Phase 4 — Test llama.cpp server

- Started: `llama-server.exe --model models\Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf --host 127.0.0.1 --port 8080 --ctx-size 8192 --n-gpu-layers 999`.
- Logs confirm Vulkan GPU is in use: `Vulkan0 : AMD Radeon RX 6600 XT (8176 MiB, 7378 MiB free)`. Note: `n_ctx_seq (8192) < n_ctx_train (131072)` warning is expected/harmless — model supports up to 131072 context, we're just not using all of it.
- `POST /v1/chat/completions` with `{"messages":[{"role":"user","content":"Reply with exactly: local model online"}],"temperature":0.2}` → `"Local model online."` — OpenAI-compatible chat works.
- Performance: prompt processing ~17.7 tok/s, generation ~49.9 tok/s (first request after warmup, 16 prompt tokens / 5 generated tokens — small sample).

## Phase 5 — SearXNG (Docker)

- Docker Desktop (installed in Phase 1) was not running by default after install — launched manually via `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`. No GUI/EULA/setup interaction was actually required (WSL2 + an existing `Ubuntu` distro were already present on this machine); it just needed ~1-2 minutes to start its backend VM (`docker-desktop` WSL distro) before `docker info` succeeded. No reboot needed.
- Wrote `infra/docker-compose.yml` (searxng/searxng:latest, bound to `127.0.0.1:8888:8080`, capability-dropped) and `infra/searxng/settings.yml` (`use_default_settings: true`, adds `json` to `search.formats`, disables the rate limiter for this single-user local instance, sets a random `server.secret_key`).
- `docker compose up -d` (run from `infra/`) — pulled image, created network `infra_default`, started container `searxng`.
- Verified port binding: `docker ps` → `127.0.0.1:8888->8080/tcp` (not exposed beyond localhost).
- Tested `http://127.0.0.1:8888/search?q=test&format=json` → valid JSON, 33 results returned.

## Phase 6/7 — Backend + frontend smoke tests

- Created backend venv (`backend/.venv`), installed `requirements.txt`, ran `playwright install chromium`. Verified `/health` returns `{"status":"ok","llama_cpp":true}` once llama.cpp is running.
- `create-next-app` scaffold (Next.js 16.2.9 / React 19.2 / Tailwind v4) + custom components (`ChatApp`, `Sidebar`, `MessageBubble`, `StatusIndicator`, `SettingsPanel`) + `lib/api.ts`, `lib/types.ts`. `npx tsc --noEmit`, `npx eslint src`, and `npm run build` all clean.
- Note: this Next.js version bundles its own docs under `node_modules/next/dist/docs` (flagged by the scaffold's own `AGENTS.md`) — confirmed no relevant breaking changes affected this app's patterns (client components, `useEffect` data fetching, etc.) before writing the UI code.
- Fixed an ESLint `react-hooks/set-state-in-effect` finding in `ChatApp.tsx`'s mount effect by switching to the React-docs-recommended `ignore` flag pattern instead of calling an async function directly in the effect body.

## Phase 9 — Final end-to-end tests

1. **Basic local chat** — `POST /chat` (`search_enabled: false`) → streamed `conversation` → `status` → `token`×N → `done` events; assembled reply correct.
2. **NSFW-safe fictional request** — asked for a tasteful adult romance scene between consenting adults → model answered directly and helpfully, per the system prompt. **Safety boundary check** — asked for sexual content involving a minor → model refused clearly, citing legal age of consent, while offering to help with legal adult content instead. Both sides of the policy verified.
3. **Web search request** — `search_enabled: true` → events showed `Searching web...` → 5 SearXNG results → `Reading page...` → Playwright-read excerpt of the top result → grounded, cited answer ("Python 3.14.6", with source links).
4. **Page reading request** — `POST /read-page` directly against `https://en.wikipedia.org/wiki/Llama.cpp` → correct title + readable excerpt.
5. **Conversation save/reload** — `GET /conversations` listed all prior sessions; `GET /conversations/{id}` returned the full user/assistant message history for a given id.
6. **Frontend end-to-end streaming** — see bug below; after the fix, verified via a headless-Chromium Playwright script (driving the real dev server, not a unit test): online indicator green, Settings panel opens/closes, typing enables Send, tokens stream into the assistant bubble live, "+ New chat" resets the view, sidebar lists all conversations, and clicking a sidebar entry reloads its full message history.

### Bug found and fixed: frontend had zero client-side interactivity on 127.0.0.1

- Symptom: page rendered correctly (SSR output looked right — sidebar, header, input box) but was **completely inert**: typing into the textarea never enabled the Send button, clicking "Settings" never opened the panel, and no requests to the backend (`127.0.0.1:8000`) were ever made. No console errors, no page errors, no React hydration-mismatch warnings — it just looked like a static screenshot of the right state.
- Root cause: Next.js 16's dev server has an `allowedDevOrigins` cross-origin protection for dev-only resources that, by default, only allowlists the `localhost` hostname — **not** the numeric loopback address `127.0.0.1`. The HMR websocket connection failed silently (`Blocked cross-origin request to Next.js dev resource ... from "127.0.0.1"`), and along with it, client-side React hydration never completed, so the page was forever stuck rendering only its initial SSR snapshot with no attached event handlers.
- Diagnosis path: confirmed the backend itself was reachable from the browser (a manual `fetch()` evaluated in-page succeeded), confirmed the compiled JS bundle did contain the component code (grepped the served chunk for a temporary debug `console.log`), then proved hydration specifically was the failure by comparing behavior on `http://localhost:3000` (worked immediately — `[HMR] connected` appeared, the debug log fired) vs `http://127.0.0.1:3000` (silently broken).
- Side discovery: `next dev`'s default host binding is **all interfaces**, not just localhost — the startup banner showed a `Network: http://<lan-ip>:3000` URL, which violates this project's "bind everything to 127.0.0.1" requirement.
- Fix (both in `frontend/`):
  - `next.config.ts`: added `allowedDevOrigins: ["127.0.0.1", "localhost"]` so hydration works regardless of which loopback hostname is used.
  - `package.json`: changed `dev`/`start` scripts to `next dev -H 127.0.0.1` / `next start -H 127.0.0.1` so the server only ever binds to the loopback interface (no LAN exposure).
- After the fix: dev server log confirmed `Local: http://127.0.0.1:3000` / `Network: http://127.0.0.1:3000` (identical, i.e. no separate LAN binding), and the full Playwright interaction test passed.

## Final state

All six hard acceptance criteria verified working simultaneously:

| Service | Status | Verified via |
|---|---|---|
| llama.cpp (Vulkan, GPU) | running, PID seen via `Get-Process llama-server` | `/v1/chat/completions`, logs show `AMD Radeon RX 6600 XT` |
| SearXNG (Docker) | `Up`, `127.0.0.1:8888->8080/tcp` | `docker ps`, JSON search response |
| FastAPI backend | running | `/health` → `{"status":"ok","llama_cpp":true}` |
| Next.js frontend | running, `127.0.0.1:3000` only | Playwright-driven UI test, HTTP 200 |

No items remain blocked on GUI/admin/reboot. Total build went through two real
failures (git clone network drop, missed `VULKAN_SDK` env var in a fresh
shell) and one subtle bug (frontend hydration silently broken on
`127.0.0.1`) — all diagnosed and fixed in-session; see above for each.

## Phase 11 — Tailscale access from phone

- `tailscale --version` / `tailscale status` showed Tailscale was not installed on this machine. Installed via `winget install -e --id Tailscale.Tailscale`.
- `tailscale status` after install: "Logged out." Ran `tailscale up --accept-risk=lose-ssh` — this normally requires visiting an interactive browser login URL, but the daemon authenticated automatically using cached/existing account state for `mshahwaiz12@gmail.com` (no browser action was actually needed). Other devices already on this tailnet: `claritas` (windows), `pixel-6-pro` (android — the user's phone), `waffle-pc` (linux).
- This machine identifies on the tailnet as `riebeck` / `riebeck.tail4fc8a6.ts.net` / `100.66.108.118`.
- Exposed services via `tailscale serve` (tailnet-only, NOT funnel/public; both still bind to `127.0.0.1` locally, `serve` just proxies):
  - `tailscale serve --bg 3000` → `https://riebeck.tail4fc8a6.ts.net/` → `127.0.0.1:3000` (frontend)
  - `tailscale serve --bg --https=8443 8000` → `https://riebeck.tail4fc8a6.ts.net:8443/` → `127.0.0.1:8000` (backend)
  - HTTPS certs were available immediately (no manual "enable HTTPS certificates" step needed for this tailnet).
- Updated `backend/.env`: added `https://riebeck.tail4fc8a6.ts.net` to `CORS_ORIGINS` — required because the frontend JS, once loaded on the phone, calls the backend directly from the phone's browser and would otherwise be CORS-blocked.
- Created `frontend/.env.local`: `NEXT_PUBLIC_BACKEND_URL=https://riebeck.tail4fc8a6.ts.net:8443` — required because `NEXT_PUBLIC_*` vars are baked into the client bundle and read in the browser (the phone), so `127.0.0.1` there would mean the phone itself, not this PC.
- Restarted backend and frontend to pick up both env changes.
- First request to the backend's tailscale URL (`:8443`) timed out at 10s (likely first-use TLS cert provisioning for that port); retried with a longer timeout and it succeeded immediately after, and was instant on subsequent calls.
- Verified: `https://riebeck.tail4fc8a6.ts.net/` → 200; `https://riebeck.tail4fc8a6.ts.net:8443/health` → `{"status":"ok","llama_cpp":true}`; cross-origin request with `Origin: https://riebeck.tail4fc8a6.ts.net` against the `:8443` backend returned the matching `Access-Control-Allow-Origin` header.
- Outstanding: the phone (`pixel-6-pro`) showed `offline, last seen 9d ago` in `tailscale status` — the user needs to open the Tailscale app on the phone itself to bring it online before `https://riebeck.tail4fc8a6.ts.net` will be reachable from it. Nothing further to do on the PC side.

## Phase 12 — One-click desktop launcher

- User asked to stop all running services and get a self-serve way to start everything without further assistance. Stopped `llama-server.exe`, the backend `uvicorn` process, the frontend `next dev` process, and ran `docker compose down` for SearXNG.
- Note: `[Environment]::GetFolderPath("Desktop")` resolves to `C:\Users\mshah\OneDrive\Desktop` on this machine (OneDrive Known Folder redirection), not the plain `C:\Users\mshah\Desktop` — the shortcut was created there.
- Added `scripts/start-all-and-wait.ps1`: starts SearXNG/llama.cpp/backend/frontend all hidden (`-WindowStyle Hidden`, output redirected to the existing log files, idempotent — skips a service if it's already running), polls each `/health` (or `/` for the frontend) until ready, prints `LLM is running: OK` plus the local and Tailscale URLs, then blocks on `Read-Host` until Enter is pressed.
- Added `C:\Users\mshah\OneDrive\Desktop\Start LLM Assistant.bat` — a thin wrapper (`powershell -NoProfile -ExecutionPolicy Bypass -File ...start-all-and-wait.ps1`) so the whole thing is double-clickable with no execution-policy prompt.
- **Bug found while testing:** the script's first real run failed with `docker : The term 'docker' is not recognized...`. Cause: double-clicking from Explorer inherits Explorer's environment, which still has the stale `PATH` from before this session's `winget` installs (Docker, Tailscale, etc.) updated the registry — the same class of issue hit earlier when testing llama.cpp/Vulkan in fresh shells. Fixed by adding an explicit `$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + ...GetEnvironmentVariable("PATH","User")` refresh at the top of `start-all-and-wait.ps1`, so it's self-sufficient regardless of how stale the launching shell's environment is.
- Verified end-to-end (since a literal double-click can't be scripted): ran the corrected script with stdin/stdout redirected to a log file (avoiding a separate pipe-buffer deadlock hit on the first attempt, when `RedirectStandardOutput` was read by nothing) and a piped blank line standing in for pressing Enter. Result: SearXNG/llama.cpp/backend/frontend all started, `LLM is running: OK` printed, the script's own `powershell.exe` process exited cleanly after consuming the simulated Enter, and all four services were confirmed still running and healthy afterward (`llama-server.exe` process present, `/health` on 8080/8000 both OK, `http://127.0.0.1:3000` returned 200).
- `stop-all.ps1` (from the original build) still applies unchanged — it matches processes by name/command-line, not by which script started them.

## Phase 13 — Frontend was non-interactive over Tailscale (dev server + HMR)

- User reported: ran the desktop launcher, got "LLM is running: OK", but the UI loaded via `https://riebeck.tail4fc8a6.ts.net` showed the offline (red) indicator and the Send button never enabled no matter what was typed.
- Direct `curl`/`Invoke-RestMethod` checks against both the frontend and backend Tailscale URLs succeeded fine, including a manual `fetch()` evaluated inside the loaded page — ruling out CORS, certs, and basic reachability.
- Reproduced with a headless-Chromium Playwright script (driving the real `https://riebeck.tail4fc8a6.ts.net` URL, not a stub): the page rendered its initial server-rendered shell correctly but stayed permanently inert (online indicator stuck false for 16+ seconds, Send button stayed disabled after typing) — the exact same symptom as the earlier `127.0.0.1` hydration bug (Phase 9), just triggered by a different cause this time.
- Root cause: the frontend was still running `next dev`. Next.js dev mode keeps a Hot Module Reload websocket open at `/_next/webpack-hmr`; `tailscale serve`'s HTTP(S) proxy doesn't tunnel that WebSocket upgrade correctly (`wss://riebeck.tail4fc8a6.ts.net/_next/webpack-hmr` failed with `Unexpected response code: 502` in the browser console). This Next.js 16/Turbopack dev runtime's hydration bootstrap appears to depend on that HMR connection succeeding, so when it 502s, client-side hydration silently never completes — no console error beyond the WS failure itself, no React warning, just a permanently non-interactive page.
- Fix: stopped using `next dev` for real usage entirely. Rebuilt for production (`npm run build`, which picks up `frontend/.env.local`) and run with `npm run start` (`next start -H 127.0.0.1`) instead. Production mode has no HMR/websocket dependency, so it's unaffected by proxy WebSocket support and is also just the more correct way to run this for actual use (not dev).
- Updated `scripts/start-frontend.ps1` and `scripts/start-all-and-wait.ps1` to build (if `frontend/.next` doesn't exist yet) and `npm run start` instead of `npm run dev`; updated `scripts/stop-all.ps1`'s process matcher to also catch `next start`/`next-server`. `scripts/start-all.ps1` needed no change — it already delegates to `start-frontend.ps1`.
- Re-verified from scratch: stopped every service, ran the (fixed) `start-all-and-wait.ps1` end-to-end (SearXNG → llama.cpp → backend → frontend build+start → health polling → `LLM is running: OK` → exits on Enter), then drove `https://riebeck.tail4fc8a6.ts.net` in headless Chromium again: online indicator green within 2s, Send enables after typing, and a full chat message streamed a real response end-to-end. Also re-confirmed `http://127.0.0.1:3000` still works locally.

## Phase 14 — Rebrand to Bonfire, UI overhaul, presets/memory, Funnel, Playwright suite

User feedback after using it: core works, but UX needs real polish; pointed at `~/glade` (a sibling project, dark minimal widget canvas) for visual inspo; asked for an editable/preset-able system prompt with auto-routing, a simple graph-based memory, public internet access via Tailscale Funnel, and a name ("Bonfire"). Explicitly said no auth gate for Funnel ("I'm the only one who'll use it") — dropped a previously-planned password-gate design as soon as that came in, no argument.

**Rebrand / restructure**
- Stopped all services (`stop-all.ps1`), then `Rename-Item local-nsfw-llm → bonfire`. First attempt failed with "in use" — my own PowerShell session's CWD was inside the folder, plus several stale `tail.exe` processes from earlier `Monitor` calls in this same session still held file handles open in it. Fixed by `Set-Location` out, killing the `tail` processes, then the rename succeeded.
- Swept every remaining `local-nsfw-llm` string: `scripts/start-all-and-wait.ps1`, `infra/docker-compose.yml` + `searxng/settings.yml` (instance name), `backend/app/main.py` (FastAPI title), `frontend/src/app/layout.tsx` (page title), and the `.venv`'s own `pyvenv.cfg`/`activate`/`activate.bat` (cosmetic only — confirmed the venv still runs fine with the stale path, fixed anyway for cleanliness). Recreated the Desktop shortcut as `Bonfire.bat` pointing at the new path; deleted the old `Start LLM Assistant.bat`.
- New flame-mark logo (three nested teardrop paths, amber→orange→pale-yellow, same palette as glade's own build-status flame) as `frontend/src/app/icon.svg` (Next.js auto-favicon convention) and `public/flame.svg` (reused inline in the header `Logo`/`FlameMark` components). Removed the unused create-next-app boilerplate SVGs and the old `favicon.ico`.

**Design system (glade-inspired)**
- Rewrote `globals.css` as a Tailwind v4 `@theme` block matching glade's tokens almost exactly: `--color-bg #0a0b0d`, `--color-surface`/`-2`/`-3`, `--color-line`/`-strong`, `--color-ink`/`-dim`/`-muted`, `--color-accent #f59e0b` (amber — doubles as the "fire" color), `--color-accent-2` (blue, focus rings), `--ease-out` cubic-bezier. Dropped `@tailwindcss/typography` entirely in favor of a small hand-written `.prose-bonfire` class (clearer contrast control between the dark assistant bubble and the light accent-colored user bubble — see bug below).
- New components: `Logo`/`FlameMark` (SVG flame, optional `flame-flicker` CSS animation reused for the generating-status indicator), `ComposerBar` (floating pill input + Web-search toggle pill + preset-mode pill with a popover menu, glade's `#dock` pattern), redesigned `Sidebar` (off-canvas drawer on mobile via `fixed` + `translate-x`, `static` on `sm:` breakpoint — standard responsive-drawer pattern), redesigned `SettingsPanel` (full-screen sheet on mobile / 420px right panel on desktop, tabbed: Prompt / Memory / Status), redesigned `MessageBubble` (preset badge above assistant replies, markdown via `.prose-bonfire`).
- **Bug caught before it shipped**: first pass of `MessageBubble` applied the same dark-text-color prose class to both bubble colors. The user bubble is light amber (`bg-accent`) — dark-on-light works, but blindly inheriting the assistant's light-ink-on-dark prose styling there would have made user messages low-contrast/unreadable. Fixed by rendering user messages as plain `whitespace-pre-wrap` text (they're not markdown-heavy anyway) and reserving `.prose-bonfire` for assistant bubbles only.

**Backend: settings, presets, auto-routing, memory** (`backend/app/`)
- New tables in `db.py`: `settings` (key/value), `presets` (id/name/description/system_prompt/keywords JSON/is_builtin), `memory_nodes` + `memory_edges` (a real, if small, graph — not just a flat fact list). Added a `_migrate()` step in `init_db()` for the `messages.preset_id` column, because `CREATE TABLE IF NOT EXISTS` doesn't alter a table that already existed from before this column existed — **hit this for real**: the first post-migration `/chat` call threw `sqlite3.OperationalError: table messages has no column named preset_id` against the live (pre-existing) `app.db`. Fixed with an explicit `PRAGMA table_info` check + `ALTER TABLE ... ADD COLUMN`.
- `presets.py`: three built-in presets (General, Coding, NSFW/Creative) seeded on startup; `pick_preset()` is a plain keyword-overlap scorer against each preset's keyword list — deliberately **not** an LLM call, so auto-routing adds zero extra latency/round-trips. The non-negotiable safety clause (refuse minors/coercion/non-consent/exploitation/doxxing/malware) lives in `config.SAFETY_BOUNDARY` and is appended server-side to whatever prompt is resolved (auto/pinned/custom) — it is not stored as editable preset text, so the Settings UI can never edit it away.
- `memory.py`: after each reply, a non-streaming llama.cpp call extracts up to 4 short facts as a JSON array, stored as graph nodes linked to a `__user__` anchor node via `knows` edges. Retrieval before the next message does keyword-overlap against fact labels, with two pragmatic fallbacks added after testing surfaced a real gap (see below): if the whole graph is small (≤ `MEMORY_MAX_CONTEXT_FACTS`, default 6), return everything rather than filtering; if a query shares no words with any fact, fall back to the most-recently-reinforced facts rather than nothing.
  - **Gap found and fixed during testing**: asked "What's my name and where do I live?" after teaching it "My name is Mustafa, I live in Toronto..." — it recalled the name but not the city, because "where do I live" shares no literal word with the stored "Location: Toronto" fact. Pure keyword overlap can't bridge that without embeddings (explicitly out of scope per "simple graph database"); the small-graph-show-everything fallback above is the pragmatic mitigation.
- `main.py` `/chat`: resolves effective system prompt (per-message `preset_id` override → saved `custom`/`preset`/`auto` mode → safety boundary appended), emits a new `preset` SSE-style event early so the UI can show which mode is in play, retrieves+injects memory facts as a system message when enabled, and stores `preset_id` on the assistant's row for the history view.
  - **Latency bug caught before shipping**: first draft called `memory.extract_and_store()` *inside* the streaming generator, after the `done` event but before the generator returned — which would have kept the HTTP stream open (and the frontend's `isStreaming` flag, and thus the Send button, disabled) for the full extra LLM round-trip needed for extraction. Fixed by moving extraction into a `starlette.background.BackgroundTask` attached to the `StreamingResponse`, populated via a small mutable `result` dict the generator fills in as it runs — Starlette only runs it after the response (generator) has fully closed, so it never delays what the client sees.
- New endpoints: `GET/PUT /settings`, `GET/POST /presets`, `PUT/DELETE /presets/{id}`, `GET/DELETE /memory`, `DELETE /memory/{id}`, `DELETE /conversations/{id}`.
- Verified end-to-end against the real running stack (not mocked): auto-routing correctly picked Coding for a Python-bug message, NSFW/Creative for an explicit-content request, and General for small talk; memory extraction populated real facts from a real exchange; manual preset pinning overrode auto-routing.

**Side effect caught and fixed**: `npm install -D @playwright/test` + `npx playwright install chromium` deleted the *Python* Playwright's chromium-1148 (and its headless-shell/ffmpeg) as "unused," since the two Playwright installs share `%LOCALAPPDATA%\ms-playwright` but track browser revisions independently per-package-version — this silently would have broken the backend's `/read-page` endpoint. Caught immediately by re-running `python -m playwright install chromium` in the backend venv before moving on; both revisions (1148 and 1228) now coexist, confirmed `/read-page` still works.

**Tailscale Funnel (no auth, per explicit user instruction)**
- `tailscale funnel --bg 3000` (frontend, :443) and `tailscale funnel --bg --https=8443 8000` (backend) — same underlying mapping table as the earlier `serve` setup, just promoted to internet-reachable; no new CORS/env changes needed since the origin hostname is unchanged, only who can reach it.
- Confirmed `tailscale funnel status` shows both as `(Funnel on)`. Could not fully verify from a genuinely non-tailnet network path (no such client available in this environment) — trusting Tailscale's own confirmation plus the fact the identical proxy plumbing was already verified end-to-end under `serve`.

**Playwright test suite** (`frontend/playwright.config.ts`, `frontend/tests/*.spec.ts`)
- Added `@playwright/test`, two projects: "Desktop Chrome" (1440×900) and "Mobile" (`devices["Pixel 7"]` — deliberately Chromium-based, not `iPhone 13`/WebKit, to avoid a separate ~300MB WebKit download for layout/touch testing that doesn't need real Safari quirks).
- 4 spec files (chat, presets/auto-routing, settings, mobile-only layout), 27 tests passing across both projects (3 mobile-only tests correctly skipped on desktop via a viewport-width `test.skip`).
- **Three real bugs in the tests themselves, found and fixed by actually running them, not just writing them**:
  1. `getByText("Routing to Coding")` never matched — the transient status line gets overwritten by "Generating answer..." within the same React batch, often before paint. Fixed by asserting on the *persistent* preset badge on the message instead.
  2. `locator("textarea").first()` inside the settings panel matched the chat composer's textarea (also present in the DOM, earlier in render order) instead of the preset editor's. Fixed by adding `data-testid="settings-panel"` to the panel root and scoping all panel-local queries through it.
  3. Settings tests mutate real shared backend state (`prompt_mode`) with no per-test isolation (this is a true e2e suite against a live SQLite DB, not mocked) — a "switch to custom mode" test running before "list presets" left `prompt_mode=custom`, which surfaced an extra Custom-prompt textarea/Save button ahead of the expected one, breaking `.first()`-based assertions and triggering Playwright strict-mode violations (multiple elements matched). Fixed with a `test.beforeEach` in both `settings.spec.ts` and `presets.spec.ts` that resets `prompt_mode` to `auto` via a direct API call before each test.
- Cleaned up afterward: deleted all 33 conversations and cleared the memory graph that accumulated from this session's testing (none were real usage) so the user starts with a blank slate; reset `/settings` to defaults.

**Final state**: rebranded, restyled, re-tested end-to-end via the real `Bonfire.bat` launcher from a cold stop — SearXNG → llama.cpp → backend → frontend (production) all healthy, `LLM is running: OK`, reachable at `http://127.0.0.1:3000` and publicly at `https://riebeck.tail4fc8a6.ts.net` (no auth, by request).
