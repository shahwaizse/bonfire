# Bonfire

Bonfire is a private local chat app for one Windows machine. It is intentionally small now: a polished React chat UI, a Node/Express API, one local llama.cpp text model, optional SearXNG web grounding, SQLite history, prompt presets, and a Tailscale Funnel switch when remote access is needed.

The goal is simple: make the local model feel fast, steady, and pleasant to talk to.

![Bonfire desktop chat](docs/bonfire-new-chat-desktop.png)

## What Runs

| Piece | Tech | Default address |
| --- | --- | --- |
| Chat model | llama.cpp OpenAI-compatible server | `127.0.0.1:8080` |
| Search | SearXNG in Docker | `127.0.0.1:8888` |
| API | Node.js + Express | `127.0.0.1:8000` |
| UI | Vite + React + shadcn | `127.0.0.1:3000` |
| Storage | SQLite | `backend/data/app.db` |

The app is text-only. Chats, settings, prompt presets, and conversation history stay on disk in `backend/data/`.

## Model

This setup is built around Dolphin 3.0 Llama 3.1 8B GGUF, Q4_K_M, served by the local llama.cpp build in `vendor/llama.cpp/`.

The model file is not committed. Put the GGUF file in `models/` and update the model path in:

```powershell
scripts\start-llama.ps1
scripts\start-all-and-wait.ps1
```

Useful runtime knobs:

```powershell
$env:LLAMA_CTX_SIZE = "8192"
$env:LLAMA_GPU_LAYERS = "999"
```

## Web Search

Search is optional per message. When enabled, Bonfire asks local SearXNG for web and image result candidates with safe search disabled by default, deduplicates and reranks them, reads a few top web pages, and gives the model compact source context. Source links and image thumbnails are shown under the assistant reply. Image thumbnails are proxied through the backend so they still load when the UI is opened through Tailscale Funnel.

Useful backend settings live in `backend/.env`:

```env
LLAMA_BASE_URL=http://127.0.0.1:8080
SEARXNG_BASE_URL=http://127.0.0.1:8888
DATABASE_PATH=./data/app.db
HOST=127.0.0.1
PORT=8000
CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,https://riebeck.tail4fc8a6.ts.net
MAX_SEARCH_RESULTS=5
MAX_PAGES_TO_READ=3
SEARCH_QUERY_VARIANTS=3
SEARCH_TIMEOUT_SECONDS=15
SEARCH_SAFESEARCH_DEFAULT=0
SEARCH_IMAGE_RESULTS=8
SEARCH_IMAGE_ENGINES=google images
SEARCH_IMAGE_FALLBACK_ENGINES=duckduckgo images,bing images,pexels,unsplash,pinterest
```

## Prompt Presets

Bonfire has editable prompt presets for General, Coding, and NSFW modes. The composer can use Auto mode, which picks a preset from the message, or you can pin a preset manually.

Prompts are assembled from:

1. Core Bonfire behavior
2. Runtime context
3. Active preset or custom system prompt
4. User guardrails
5. Web/page context when search is enabled
6. Recent conversation history

## Run

The normal launcher starts the whole stack:

```powershell
.\scripts\start-all-and-wait.ps1
```

It starts Docker Desktop if needed, starts SearXNG, starts llama.cpp, starts the Express API, starts Vite, reapplies the saved Funnel setting, then prints local URLs.

Open:

```text
http://127.0.0.1:3000
```

For separate visible service windows:

```powershell
.\scripts\start-all.ps1
```

## Stop

From the UI:

```text
Settings -> Status -> Shut down Bonfire
```

From PowerShell:

```powershell
.\scripts\stop-all.ps1
```

The shutdown path force-stops the local model server, API, and frontend first so RAM and VRAM are returned quickly, then cleans up SearXNG and Funnel routes.

## Tailscale Funnel

Funnel is optional and stored in Bonfire settings. When enabled:

```text
https://riebeck.tail4fc8a6.ts.net       -> frontend on 127.0.0.1:3000
https://riebeck.tail4fc8a6.ts.net:8443  -> backend on 127.0.0.1:8000
```

There is no app-level auth gate. Keep Funnel off unless you explicitly need public remote access.

Manual checks:

```powershell
tailscale funnel status
.\scripts\apply-funnel-setting.ps1
.\scripts\set-funnel.ps1 -Enabled true
.\scripts\set-funnel.ps1 -Enabled false
```

## Setup

Prerequisites:

- Git
- Node.js LTS
- Docker Desktop with WSL2
- Visual Studio Build Tools for C++
- CMake + Ninja
- Vulkan SDK
- Tailscale, only for Funnel

Install dependencies:

```powershell
cd backend
npm install

cd ..\frontend
npm install
```

The launch scripts create `backend/.env` from `backend/.env.example` when it does not exist.

## Testing

Backend:

```powershell
cd backend
npm test
```

Frontend build:

```powershell
cd frontend
npm run build
```

End-to-end:

```powershell
cd frontend
npx playwright test
```

The Playwright suite expects the backend and model server to be available on their default ports.

## Useful Checks

```powershell
docker ps
Invoke-RestMethod "http://127.0.0.1:8888/search?q=test&format=json"
Invoke-RestMethod "http://127.0.0.1:8000/health"
Invoke-RestMethod "http://127.0.0.1:8080/health"
tailscale funnel status
```

If SearXNG returns HTML instead of JSON, check `infra/searxng/settings.yml` and make sure `json` is listed under `search.formats`.

## Repo Layout

```text
bonfire/
├── backend/   Express API, prompt assembly, search, presets, settings
├── frontend/  Vite + React chat UI and Playwright tests
├── infra/     Docker Compose and SearXNG settings
├── models/    Local GGUF files, ignored by git
├── scripts/   Windows startup, shutdown, Docker, and Funnel helpers
├── docs/      README screenshots
└── vendor/    Local llama.cpp checkout/build, ignored by git
```
