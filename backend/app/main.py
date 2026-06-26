import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app import db, memory, presets, system_control
from app.config import CORS_ORIGINS, DEFAULT_GUARDRAILS, MAX_PAGES_TO_READ
from app.llama_client import chat_completion, close_client, health_check, start_client, stream_chat_completion
from app.models import (
    ChatRequest,
    ConversationDetailOut,
    ConversationOut,
    ConversationUpdateRequest,
    FunnelStatusOut,
    FunnelUpdateRequest,
    MemoryCreateRequest,
    MemoryGraphOut,
    MemoryOut,
    MemoryStatusOut,
    MemoryUpdateRequest,
    PresetCreateRequest,
    PresetOut,
    PresetUpdateRequest,
    ReadPageRequest,
    ReadPageResponse,
    SearchRequest,
    SearchResponse,
    SettingsOut,
    SettingsUpdateRequest,
)
from app.page_reader import close_browser, read_page as playwright_read_page
from app.prompting import build_memory_context, build_system_prompt, build_web_context, select_recent_history
from app.presets import GENERAL_ID
from app.searxng_client import search as searxng_search, wants_image_results

SETTINGS_KEYS = [
    "prompt_mode",
    "active_preset_id",
    "custom_prompt",
    "search_default",
    "guardrails",
    "memory_enabled",
    "memory_auto_extract",
    "funnel_enabled",
]
SETTINGS_DEFAULTS = {
    "prompt_mode": "auto",
    "active_preset_id": GENERAL_ID,
    "custom_prompt": "",
    "search_default": "false",
    "guardrails": DEFAULT_GUARDRAILS,
    "memory_enabled": "true",
    "memory_auto_extract": "true",
    "funnel_enabled": "false",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    await memory.init_memory()
    await presets.ensure_builtin_presets()
    await start_client()
    yield
    await close_browser()
    await close_client()


app = FastAPI(title="Bonfire backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _event(event_type: str, data) -> bytes:
    return (json.dumps({"type": event_type, "data": data}) + "\n").encode("utf-8")


async def _get_settings() -> dict:
    raw = await db.get_settings(SETTINGS_KEYS)
    merged = {k: (raw.get(k) if raw.get(k) is not None else SETTINGS_DEFAULTS[k]) for k in SETTINGS_KEYS}
    return {
        "prompt_mode": merged["prompt_mode"],
        "active_preset_id": merged["active_preset_id"],
        "custom_prompt": merged["custom_prompt"],
        "search_default": merged["search_default"] == "true",
        "guardrails": merged["guardrails"],
        "memory_enabled": merged["memory_enabled"] == "true",
        "memory_auto_extract": merged["memory_auto_extract"] == "true",
        "funnel_enabled": merged["funnel_enabled"] == "true",
    }


def _preset_to_out(row: dict) -> PresetOut:
    return PresetOut(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        system_prompt=row["system_prompt"],
        keywords=json.loads(row["keywords"] or "[]"),
        is_builtin=bool(row["is_builtin"]),
    )


@app.get("/health")
async def health():
    llama_ok = await health_check()
    return {"status": "ok", "llama_cpp": llama_ok}


@app.post("/search", response_model=SearchResponse)
async def search_endpoint(req: SearchRequest):
    try:
        results = await searxng_search(
            req.query,
            req.max_results,
            include_images=req.include_images,
            safe_search=req.safe_search,
            time_range=req.time_range,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"SearXNG request failed: {exc}") from exc
    return SearchResponse(query=req.query, results=results)


@app.post("/read-page", response_model=ReadPageResponse)
async def read_page_endpoint(req: ReadPageRequest):
    try:
        result = await playwright_read_page(req.url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to read page: {exc}") from exc
    return ReadPageResponse(**result)


@app.get("/conversations", response_model=list[ConversationOut])
async def list_conversations_endpoint():
    rows = await db.list_conversations()
    return [ConversationOut(**row) for row in rows]


@app.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
async def get_conversation_endpoint(conversation_id: str):
    convo = await db.get_conversation(conversation_id)
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = await db.get_conversation_messages(conversation_id)
    for message in messages:
        if message.get("sources"):
            try:
                message["sources"] = json.loads(message["sources"])
            except json.JSONDecodeError:
                message["sources"] = None
        if message.get("memory_ids"):
            try:
                message["memory_ids"] = json.loads(message["memory_ids"])
            except json.JSONDecodeError:
                message["memory_ids"] = None
    return ConversationDetailOut(**convo, messages=messages)


@app.delete("/conversations/{conversation_id}")
async def delete_conversation_endpoint(conversation_id: str):
    await memory.archive_memories_for_conversation(conversation_id)
    await db.delete_conversation(conversation_id)
    return {"ok": True}


@app.patch("/conversations/{conversation_id}", response_model=ConversationOut)
async def update_conversation_endpoint(conversation_id: str, req: ConversationUpdateRequest):
    updates = req.model_dump(exclude_unset=True)
    if "title" in updates and updates["title"] is not None:
        updates["title"] = updates["title"].strip() or "Untitled conversation"
    if "folder" in updates and updates["folder"] is not None:
        updates["folder"] = updates["folder"].strip()

    convo = await db.update_conversation(conversation_id, **updates)
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return ConversationOut(**convo)


# ---------------------------------------------------------------- settings


@app.get("/settings", response_model=SettingsOut)
async def get_settings_endpoint():
    return SettingsOut(**await _get_settings())


@app.put("/settings", response_model=SettingsOut)
async def update_settings_endpoint(req: SettingsUpdateRequest):
    updates = req.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if isinstance(value, bool):
            value = "true" if value else "false"
        await db.set_setting(key, str(value))
    return SettingsOut(**await _get_settings())


@app.get("/system/funnel", response_model=FunnelStatusOut)
async def funnel_status_endpoint():
    settings = await _get_settings()
    status = system_control.funnel_status()
    return FunnelStatusOut(saved_enabled=settings["funnel_enabled"], **status)


@app.post("/system/funnel", response_model=SettingsOut)
async def update_funnel_endpoint(req: FunnelUpdateRequest):
    try:
        system_control.set_funnel_enabled(req.enabled)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to update Tailscale Funnel: {exc}") from exc
    await db.set_setting("funnel_enabled", "true" if req.enabled else "false")
    return SettingsOut(**await _get_settings())


@app.post("/system/shutdown")
async def shutdown_endpoint():
    system_control.schedule_shutdown()
    return {"ok": True}


# ---------------------------------------------------------------- memory


@app.get("/memories", response_model=list[MemoryOut])
async def list_memories_endpoint(query: str = "", include_archived: bool = False):
    rows = await memory.list_memories(query=query, include_archived=include_archived)
    return [MemoryOut(**row) for row in rows]


@app.get("/memories/status", response_model=MemoryStatusOut)
async def memory_status_endpoint():
    return MemoryStatusOut(**await memory.memory_status())


@app.get("/memories/graph", response_model=MemoryGraphOut)
async def memory_graph_endpoint():
    return MemoryGraphOut(**await memory.memory_graph())


@app.post("/memories", response_model=MemoryOut)
async def create_memory_endpoint(req: MemoryCreateRequest):
    row = await memory.remember_text(
        req.text,
        kind=req.kind,
        topics=req.topics,
        entities=req.entities,
        confidence=req.confidence,
        pinned=req.pinned,
        dedupe=False,
    )
    return MemoryOut(**row)


@app.patch("/memories/{memory_id}", response_model=MemoryOut)
async def update_memory_endpoint(memory_id: str, req: MemoryUpdateRequest):
    row = await memory.update_memory(memory_id, **req.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(status_code=404, detail="Memory not found")
    return MemoryOut(**row)


@app.delete("/memories/{memory_id}")
async def delete_memory_endpoint(memory_id: str):
    await memory.delete_memory(memory_id)
    return {"ok": True}


@app.post("/memories/rebuild", response_model=MemoryStatusOut)
async def rebuild_memory_index_endpoint():
    return MemoryStatusOut(**await memory.rebuild_chroma_index())


@app.delete("/memories")
async def clear_memories_endpoint():
    await memory.clear_memories()
    return {"ok": True}


# ---------------------------------------------------------------- presets


@app.get("/presets", response_model=list[PresetOut])
async def list_presets_endpoint():
    rows = await db.list_presets()
    return [_preset_to_out(r) for r in rows]


@app.post("/presets", response_model=PresetOut)
async def create_preset_endpoint(req: PresetCreateRequest):
    import re
    import uuid

    slug = re.sub(r"[^a-z0-9]+", "-", req.name.lower()).strip("-") or uuid.uuid4().hex[:8]
    existing = await db.get_preset(slug)
    preset_id = slug if not existing else f"{slug}-{uuid.uuid4().hex[:6]}"
    await db.upsert_preset(
        preset_id=preset_id,
        name=req.name,
        description=req.description,
        system_prompt=req.system_prompt,
        keywords=json.dumps(req.keywords),
        is_builtin=False,
        sort_order=100,
    )
    row = await db.get_preset(preset_id)
    return _preset_to_out(row)


@app.put("/presets/{preset_id}", response_model=PresetOut)
async def update_preset_endpoint(preset_id: str, req: PresetUpdateRequest):
    row = await db.get_preset(preset_id)
    if not row:
        raise HTTPException(status_code=404, detail="Preset not found")
    updates = req.model_dump(exclude_unset=True)
    if "keywords" in updates:
        updates["keywords"] = json.dumps(updates["keywords"])
    if updates:
        await db.update_preset(preset_id, **updates)
    row = await db.get_preset(preset_id)
    return _preset_to_out(row)


@app.delete("/presets/{preset_id}")
async def delete_preset_endpoint(preset_id: str):
    if preset_id == GENERAL_ID:
        raise HTTPException(status_code=400, detail="Cannot delete the General preset")
    await db.delete_preset(preset_id)
    return {"ok": True}


# ---------------------------------------------------------------- chat


async def _resolve_system_prompt(req: ChatRequest, all_presets: list[dict]) -> tuple[str, str]:
    """Returns (system_prompt, preset_id_used_or_'custom')."""
    by_id = {p["id"]: p for p in all_presets}

    if req.preset_id and req.preset_id in by_id:
        p = by_id[req.preset_id]
        return p["system_prompt"], p["id"]

    settings = await _get_settings()
    if settings["prompt_mode"] == "custom" and settings["custom_prompt"].strip():
        return settings["custom_prompt"], "custom"

    if settings["prompt_mode"] == "preset" and settings["active_preset_id"] in by_id:
        p = by_id[settings["active_preset_id"]]
        return p["system_prompt"], p["id"]

    # auto mode (default)
    chosen = await presets.pick_preset(req.message, all_presets)
    return chosen["system_prompt"], chosen["id"]


async def _read_search_pages(results: list[dict]) -> list[dict]:
    pages_to_read = [r for r in results if r.get("kind", "web") == "web" and r.get("url")][:MAX_PAGES_TO_READ]
    if not pages_to_read:
        return []

    async def read_one(result: dict) -> dict | None:
        try:
            return await playwright_read_page(result["url"])
        except Exception:
            return None

    page_reads = await asyncio.gather(*(read_one(result) for result in pages_to_read))
    return [page for page in page_reads if page]


def _build_search_query(message: str, history: list[dict]) -> str:
    current = " ".join(message.split())
    lowered = current.lower()
    words = {word.strip(".,!?;:()[]{}\"'") for word in lowered.split()}
    referential = any(
        token in words
        for token in {"it", "its", "they", "them", "that", "this", "those", "these", "he", "she", "his", "her"}
    )
    if len(current) > 120 and not referential:
        return current[:320]

    previous_user_messages = [
        " ".join(m.get("content", "").split())
        for m in history
        if m.get("role") == "user" and m.get("content") != message
    ]
    if not previous_user_messages:
        return current[:320]
    return f"{previous_user_messages[-1]} {current}"[:320]


async def _generate_conversation_title(message: str) -> str | None:
    prompt = (
        "Create a concise chat title for this first user message.\n"
        "Rules: 2 to 6 words, no quotation marks, no trailing punctuation, no generic words like Chat or Conversation.\n\n"
        f"User message:\n{message[:1200]}\n\n"
        "Title:"
    )
    try:
        raw = await chat_completion(
            [{"role": "user", "content": prompt}],
            temperature=0.15,
            max_tokens=24,
        )
    except Exception:
        return None

    title = raw.strip().splitlines()[0].strip().strip("\"'`*_ ")
    title = " ".join(title.split())
    if not title:
        return None
    if len(title) > 60:
        title = title[:60].rstrip(" -:,.")
    return title or None


@app.post("/chat")
async def chat_endpoint(req: ChatRequest):
    settings = await _get_settings()
    all_presets = await db.list_presets()
    mode_prompt, preset_id = await _resolve_system_prompt(req, all_presets)
    full_system_prompt = build_system_prompt(mode_prompt, settings["guardrails"])

    async def event_stream():
        conversation_id = req.conversation_id
        sources = []
        memory_ids: list[str] = []
        saved_assistant = False
        is_new_conversation = False
        if not conversation_id:
            conversation_id = await db.create_conversation("New chat")
            is_new_conversation = True
            yield _event("conversation", {"conversation_id": conversation_id, "title": "New chat"})

        user_message_id = await db.add_message(conversation_id, "user", req.message)

        if settings["memory_enabled"]:
            directive_result = await memory.process_user_memory_directives(conversation_id, user_message_id, req.message)
            if directive_result["created"] or directive_result["archived"]:
                yield _event(
                    "memory_update",
                    {
                        "created": [memory.memories_for_prompt([item])[0] for item in directive_result["created"]],
                        "archived": [memory.memories_for_prompt([item])[0] for item in directive_result["archived"]],
                    },
                )

        if is_new_conversation:
            generated_title = await _generate_conversation_title(req.message)
            if generated_title:
                current_conversation = await db.get_conversation(conversation_id)
                if current_conversation and current_conversation.get("title") == "New chat":
                    await db.update_conversation(conversation_id, title=generated_title)
                    yield _event("conversation_title", {"conversation_id": conversation_id, "title": generated_title})

        preset_name = next((p["name"] for p in all_presets if p["id"] == preset_id), preset_id.title())
        yield _event("preset", {"id": preset_id, "name": preset_name})

        history = await db.get_conversation_messages(conversation_id)
        llm_messages = [{"role": "system", "content": full_system_prompt}]

        if settings["memory_enabled"]:
            yield _event("status", "Remembering relevant context...")
            relevant_memories = memory.memories_for_prompt(
                await memory.retrieve_memories(req.message, limit=memory.MEMORY_CONTEXT_LIMIT)
            )
            if relevant_memories:
                memory_ids = [item["id"] for item in relevant_memories]
                await memory.mark_memories_used(memory_ids)
                llm_messages.append({"role": "system", "content": build_memory_context(relevant_memories)})
                yield _event("memory", relevant_memories)

        if req.search_enabled:
            search_query = _build_search_query(req.message, history)
            include_images = wants_image_results(req.message)
            safe_search = 0 if preset_id == "nsfw" else None
            yield _event("status", "Searching web and images..." if include_images else "Searching web...")
            try:
                results = await searxng_search(
                    search_query,
                    include_images=include_images,
                    safe_search=safe_search,
                )
            except Exception as exc:
                results = []
                yield _event("status", f"Web search failed: {exc}")

            if results:
                sources = results
                yield _event("search_results", results)
                web_result_count = len([result for result in results if result.get("kind", "web") == "web"])
                if web_result_count:
                    yield _event("status", "Reading sources...")
                page_reads = await _read_search_pages(results)
                if web_result_count and not page_reads:
                    yield _event("status", "Page read failed; using search snippets only.")
                for page in page_reads:
                    yield _event("page_read", page)

                llm_messages.append(
                    {
                        "role": "system",
                        "content": build_web_context(results, page_reads),
                    }
                )

        for m in select_recent_history(history):
            llm_messages.append({"role": m["role"], "content": m["content"]})

        yield _event("status", "Generating answer...")

        assistant_text = []
        try:
            async for token in stream_chat_completion(llm_messages):
                assistant_text.append(token)
                yield _event("token", token)
        except Exception as exc:
            yield _event("error", f"llama.cpp request failed: {exc}")
        finally:
            full_response = "".join(assistant_text)
            if full_response and not saved_assistant:
                assistant_message_id = await db.add_message(
                    conversation_id,
                    "assistant",
                    full_response,
                    preset_id=preset_id,
                    sources=json.dumps(sources) if sources else None,
                    memory_ids=json.dumps(memory_ids) if memory_ids else None,
                )
                await db.touch_conversation(conversation_id)
                saved_assistant = True
                if settings["memory_enabled"] and settings["memory_auto_extract"]:
                    memory.schedule_turn_extraction(
                        conversation_id,
                        user_message_id,
                        assistant_message_id,
                        req.message,
                        full_response,
                    )

        yield _event("done", {"conversation_id": conversation_id})

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")
