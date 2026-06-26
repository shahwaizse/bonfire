import asyncio
import hashlib
import json
import math
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import aiosqlite

from app import db as app_db
from app.config import (
    MEMORY_CHROMA_PATH,
    MEMORY_COLLECTION_NAME,
    MEMORY_CONTEXT_LIMIT,
    MEMORY_EMBEDDING_DIM,
    MEMORY_EXTRACT_MAX_TOKENS,
    MEMORY_MIN_RELEVANCE,
    MEMORY_RETRIEVAL_LIMIT,
)
from app.llama_client import chat_completion

try:
    import chromadb
    from chromadb.config import Settings as ChromaSettings
except Exception:  # pragma: no cover - exercised only when dependency is absent.
    chromadb = None
    ChromaSettings = None


MEMORY_KINDS = {"semantic", "preference", "episodic", "procedural"}
_client = None
_collection = None
_chroma_available = False
_extract_semaphore = asyncio.Semaphore(1)

_WORD_RE = re.compile(r"[a-z0-9][a-z0-9_'\-]*", re.IGNORECASE)
_ENTITY_RE = re.compile(r"\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b")
_STOPWORDS = {
    "about",
    "after",
    "again",
    "also",
    "because",
    "before",
    "being",
    "between",
    "could",
    "from",
    "have",
    "into",
    "just",
    "like",
    "more",
    "most",
    "much",
    "need",
    "needs",
    "only",
    "over",
    "please",
    "prefer",
    "really",
    "should",
    "that",
    "their",
    "there",
    "these",
    "thing",
    "things",
    "this",
    "want",
    "wants",
    "when",
    "where",
    "which",
    "while",
    "with",
    "would",
    "your",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item).strip() for item in parsed if str(item).strip()]


def _clean_list(items: list[Any], limit: int = 10) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in items or []:
        text = " ".join(str(item).split()).strip(" ,.;:")
        if not text or len(text) > 80:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
        if len(cleaned) >= limit:
            break
    return cleaned


def _normalize_text(text: str) -> str:
    return " ".join(text.split()).strip()


def _tokens(text: str) -> list[str]:
    return [match.group(0).casefold().strip("'\"`") for match in _WORD_RE.finditer(text)]


def _embedding(text: str, dim: int = MEMORY_EMBEDDING_DIM) -> list[float]:
    """Stable local hashed embedding.

    This keeps Bonfire's memory fully offline and deterministic. Chroma owns the
    persistent vector index; this function only supplies vectors without model
    downloads or external embedding services.
    """
    vector = [0.0] * dim
    tokens = _tokens(text)
    features: list[tuple[str, float]] = []
    features.extend((f"w:{token}", 1.0) for token in tokens)
    features.extend((f"b:{tokens[i]} {tokens[i + 1]}", 1.4) for i in range(len(tokens) - 1))
    for token in tokens:
        if len(token) < 4:
            continue
        padded = f" {token} "
        features.extend((f"c:{padded[i:i + 3]}", 0.35) for i in range(len(padded) - 2))

    if not features:
        return vector

    for feature, weight in features:
        digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % dim
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[index] += sign * weight

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def _lexical_similarity(left: str, right: str) -> float:
    left_tokens = {token for token in _tokens(left) if token not in _STOPWORDS}
    right_tokens = {token for token in _tokens(right) if token not in _STOPWORDS}
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = len(left_tokens & right_tokens)
    union = len(left_tokens | right_tokens)
    jaccard = overlap / union if union else 0.0
    coverage = overlap / min(len(left_tokens), len(right_tokens))
    substring = 0.18 if left.casefold() in right.casefold() or right.casefold() in left.casefold() else 0.0
    return min(1.0, (jaccard * 0.65) + (coverage * 0.35) + substring)


def _identity_tokens(text: str) -> set[str]:
    return {token for token in _tokens(text) if any(char.isdigit() for char in token)}


def _classify_kind(text: str) -> str:
    lowered = text.casefold()
    if any(word in lowered for word in ["prefer", "preference", "favorite", "likes ", "like to", "love ", "hate "]):
        return "preference"
    if any(phrase in lowered for phrase in ["always ", "when you", "respond", "call me", "address me", "write in"]):
        return "procedural"
    if any(phrase in lowered for phrase in ["i did", "i went", "we met", "last week", "yesterday", "today i"]):
        return "episodic"
    return "semantic"


def _infer_topics(text: str, limit: int = 6) -> list[str]:
    counts: dict[str, int] = {}
    for token in _tokens(text):
        if len(token) < 4 or token in _STOPWORDS:
            continue
        counts[token] = counts.get(token, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [token for token, _ in ranked[:limit]]


def _infer_entities(text: str, limit: int = 8) -> list[str]:
    entities = [match.group(0).strip() for match in _ENTITY_RE.finditer(text)]
    return _clean_list(entities, limit=limit)


def _row_to_memory(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "text": row["text"],
        "kind": row["kind"],
        "scope": row["scope"],
        "topics": _json_list(row.get("topics")),
        "entities": _json_list(row.get("entities")),
        "confidence": float(row["confidence"]),
        "pinned": bool(row["pinned"]),
        "archived": bool(row["archived"]),
        "source_conversation_id": row.get("source_conversation_id"),
        "source_message_id": row.get("source_message_id"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "last_used_at": row.get("last_used_at"),
        "use_count": int(row["use_count"] or 0),
    }


def _memory_metadata(memory: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": memory["kind"],
        "scope": memory.get("scope", "user"),
        "confidence": float(memory.get("confidence") or 0.0),
        "pinned": bool(memory.get("pinned")),
        "archived": bool(memory.get("archived")),
        "topics": ", ".join(memory.get("topics") or []),
        "entities": ", ".join(memory.get("entities") or []),
        "updated_at": memory.get("updated_at") or "",
    }


async def init_memory() -> None:
    """Initialize Chroma and reindex SQLite memory rows into the vector store."""
    global _client, _collection, _chroma_available
    if chromadb is None or ChromaSettings is None:
        _client = None
        _collection = None
        _chroma_available = False
        return

    os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
    os.makedirs(MEMORY_CHROMA_PATH, exist_ok=True)
    try:
        _client = chromadb.PersistentClient(
            path=MEMORY_CHROMA_PATH,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        _collection = _client.get_or_create_collection(
            name=MEMORY_COLLECTION_NAME,
            metadata={"description": "Bonfire long-term user memory", "hnsw:space": "cosine"},
        )
        _chroma_available = True
        await reindex_memories()
    except Exception:
        _client = None
        _collection = None
        _chroma_available = False


async def memory_status() -> dict[str, Any]:
    async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
        cursor = await conn.execute("SELECT COUNT(*) FROM memory_items WHERE archived = 0")
        active = (await cursor.fetchone())[0]
        cursor = await conn.execute("SELECT COUNT(*) FROM memory_items WHERE archived = 1")
        archived = (await cursor.fetchone())[0]
    chroma_count = None
    if _collection is not None:
        try:
            chroma_count = _collection.count()
        except Exception:
            chroma_count = None
    return {
        "active": active,
        "archived": archived,
        "chroma_available": _chroma_available,
        "chroma_count": chroma_count,
    }


async def _get_memory_rows_by_ids(ids: list[str]) -> list[dict[str, Any]]:
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(f"SELECT * FROM memory_items WHERE id IN ({placeholders})", ids)
        rows = [dict(row) for row in await cursor.fetchall()]
    by_id = {row["id"]: row for row in rows}
    return [by_id[item_id] for item_id in ids if item_id in by_id]


async def get_memory(memory_id: str) -> dict[str, Any] | None:
    rows = await _get_memory_rows_by_ids([memory_id])
    return _row_to_memory(rows[0]) if rows else None


async def _upsert_chroma(memory: dict[str, Any]) -> None:
    if _collection is None:
        return
    try:
        _collection.upsert(
            ids=[memory["id"]],
            documents=[memory["text"]],
            embeddings=[_embedding(memory["text"])],
            metadatas=[_memory_metadata(memory)],
        )
    except Exception:
        # Chroma should improve retrieval, not make chat fail.
        return


async def _delete_chroma(ids: list[str]) -> None:
    if _collection is None or not ids:
        return
    try:
        _collection.delete(ids=ids)
    except Exception:
        return


async def reindex_memories() -> None:
    if _collection is None:
        return
    memories = await list_memories(include_archived=True, limit=10_000)
    for memory in memories:
        await _upsert_chroma(memory)


async def rebuild_chroma_index() -> dict[str, Any]:
    global _collection
    if _client is None:
        await init_memory()
    if _client is None:
        return await memory_status()
    try:
        _client.delete_collection(name=MEMORY_COLLECTION_NAME)
    except Exception:
        pass
    _collection = _client.get_or_create_collection(
        name=MEMORY_COLLECTION_NAME,
        metadata={"description": "Bonfire long-term user memory", "hnsw:space": "cosine"},
    )
    await reindex_memories()
    return await memory_status()


async def list_memories(
    query: str | None = None,
    include_archived: bool = False,
    limit: int = 200,
) -> list[dict[str, Any]]:
    query = _normalize_text(query or "")
    if query:
        semantic = await retrieve_memories(
            query,
            limit=min(max(limit, 20), 200),
            include_archived=include_archived,
            min_relevance=0.0,
        )
        like = f"%{query}%"
        archived_sql = "" if include_archived else "AND archived = 0"
        async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            cursor = await conn.execute(
                f"""
                SELECT * FROM memory_items
                WHERE (text LIKE ? OR topics LIKE ? OR entities LIKE ?) {archived_sql}
                ORDER BY pinned DESC, updated_at DESC
                LIMIT ?
                """,
                (like, like, like, limit),
            )
            rows = [_row_to_memory(dict(row)) for row in await cursor.fetchall()]
        merged: dict[str, dict[str, Any]] = {memory["id"]: memory for memory in semantic}
        for memory in rows:
            merged[memory["id"]] = memory
        return list(merged.values())[:limit]

    archived_sql = "" if include_archived else "WHERE archived = 0"
    async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute(
            f"""
            SELECT * FROM memory_items
            {archived_sql}
            ORDER BY pinned DESC, updated_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [_row_to_memory(dict(row)) for row in await cursor.fetchall()]


async def _find_duplicate(text: str, kind: str) -> dict[str, Any] | None:
    candidates = await retrieve_memories(text, limit=6, include_archived=False, min_relevance=0.0)
    normalized = text.casefold()
    query_identity = _identity_tokens(text)
    best: tuple[float, dict[str, Any]] | None = None
    for memory in candidates:
        if memory["archived"]:
            continue
        memory_identity = _identity_tokens(memory["text"])
        if query_identity and memory_identity and query_identity != memory_identity:
            continue
        lexical = _lexical_similarity(text, memory["text"])
        exactish = normalized == memory["text"].casefold()
        same_kind = kind == memory["kind"]
        score = max(float(memory.get("_score", 0.0)), lexical)
        if exactish:
            return memory
        if same_kind and (score >= 0.78 or lexical >= 0.62):
            if best is None or score > best[0]:
                best = (score, memory)
    return best[1] if best else None


async def remember_text(
    text: str,
    kind: str = "semantic",
    topics: list[str] | None = None,
    entities: list[str] | None = None,
    confidence: float = 0.7,
    pinned: bool = False,
    archived: bool = False,
    source_conversation_id: str | None = None,
    source_message_id: int | None = None,
    dedupe: bool = True,
) -> dict[str, Any]:
    text = _normalize_text(text)
    if not text:
        raise ValueError("Memory text is required")
    kind = kind if kind in MEMORY_KINDS else _classify_kind(text)
    topics = _clean_list(topics or _infer_topics(text), limit=10)
    entities = _clean_list(entities or _infer_entities(text), limit=10)
    confidence = max(0.0, min(1.0, float(confidence)))

    existing = await _find_duplicate(text, kind) if dedupe else None
    now = _now()
    if existing:
        memory_id = existing["id"]
        merged_topics = _clean_list([*existing["topics"], *topics], limit=10)
        merged_entities = _clean_list([*existing["entities"], *entities], limit=10)
        next_text = text if len(text) > len(existing["text"]) * 1.15 else existing["text"]
        next_confidence = max(confidence, existing["confidence"])
        async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
            await conn.execute(
                """
                UPDATE memory_items
                SET text = ?, kind = ?, topics = ?, entities = ?, confidence = ?,
                    pinned = MAX(pinned, ?), archived = ?, source_conversation_id = COALESCE(?, source_conversation_id),
                    source_message_id = COALESCE(?, source_message_id), updated_at = ?
                WHERE id = ?
                """,
                (
                    next_text,
                    kind,
                    json.dumps(merged_topics),
                    json.dumps(merged_entities),
                    next_confidence,
                    int(pinned),
                    int(archived),
                    source_conversation_id,
                    source_message_id,
                    now,
                    memory_id,
                ),
            )
            await conn.commit()
        memory = await get_memory(memory_id)
        if memory:
            await _upsert_chroma(memory)
            return memory

    memory_id = str(uuid.uuid4())
    async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
        await conn.execute(
            """
            INSERT INTO memory_items (
                id, text, kind, scope, topics, entities, confidence, pinned, archived,
                source_conversation_id, source_message_id, created_at, updated_at
            )
            VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                memory_id,
                text,
                kind,
                json.dumps(topics),
                json.dumps(entities),
                confidence,
                int(pinned),
                int(archived),
                source_conversation_id,
                source_message_id,
                now,
                now,
            ),
        )
        await conn.commit()
    memory = await get_memory(memory_id)
    if memory:
        await _upsert_chroma(memory)
        return memory
    raise RuntimeError("Failed to create memory")


async def update_memory(memory_id: str, **fields: Any) -> dict[str, Any] | None:
    allowed = {"text", "kind", "topics", "entities", "confidence", "pinned", "archived"}
    updates = {key: value for key, value in fields.items() if key in allowed and value is not None}
    if "text" in updates:
        updates["text"] = _normalize_text(str(updates["text"]))
        if not updates["text"]:
            updates.pop("text")
    if "kind" in updates and updates["kind"] not in MEMORY_KINDS:
        updates["kind"] = "semantic"
    if "topics" in updates:
        updates["topics"] = json.dumps(_clean_list(updates["topics"], limit=10))
    if "entities" in updates:
        updates["entities"] = json.dumps(_clean_list(updates["entities"], limit=10))
    if "confidence" in updates:
        updates["confidence"] = max(0.0, min(1.0, float(updates["confidence"])))
    for key in ("pinned", "archived"):
        if key in updates:
            updates[key] = int(bool(updates[key]))
    if not updates:
        return await get_memory(memory_id)
    updates["updated_at"] = _now()
    columns = ", ".join(f"{key} = ?" for key in updates)
    async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
        await conn.execute(f"UPDATE memory_items SET {columns} WHERE id = ?", (*updates.values(), memory_id))
        await conn.commit()
    memory = await get_memory(memory_id)
    if memory:
        await _upsert_chroma(memory)
    return memory


async def delete_memory(memory_id: str) -> None:
    async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
        await conn.execute("DELETE FROM memory_items WHERE id = ?", (memory_id,))
        await conn.commit()
    await _delete_chroma([memory_id])


async def clear_memories() -> None:
    async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
        await conn.execute("DELETE FROM memory_items")
        await conn.commit()
    await rebuild_chroma_index()


async def archive_memories_for_conversation(conversation_id: str) -> int:
    async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cursor = await conn.execute("SELECT id FROM memory_items WHERE source_conversation_id = ?", (conversation_id,))
        ids = [row["id"] for row in await cursor.fetchall()]
        await conn.execute(
            "UPDATE memory_items SET archived = 1, updated_at = ? WHERE source_conversation_id = ?",
            (_now(), conversation_id),
        )
        await conn.commit()
    for row in await _get_memory_rows_by_ids(ids):
        await _upsert_chroma(_row_to_memory(row))
    return len(ids)


async def retrieve_memories(
    query: str,
    limit: int = MEMORY_CONTEXT_LIMIT,
    include_archived: bool = False,
    min_relevance: float = MEMORY_MIN_RELEVANCE,
) -> list[dict[str, Any]]:
    query = _normalize_text(query)
    if not query:
        return []

    ids: list[str] = []
    vector_scores: dict[str, float] = {}
    if _collection is not None:
        try:
            count = _collection.count()
            if count:
                result = _collection.query(
                    query_embeddings=[_embedding(query)],
                    n_results=min(max(limit * 4, 12), count),
                    where=None if include_archived else {"archived": False},
                    include=["distances"],
                )
                result_ids = result.get("ids", [[]])[0]
                distances = result.get("distances", [[]])[0]
                for item_id, distance in zip(result_ids, distances):
                    ids.append(item_id)
                    vector_scores[item_id] = max(0.0, 1.0 - (float(distance) / 2.0))
        except Exception:
            ids = []
            vector_scores = {}

    if not ids:
        archived_sql = "" if include_archived else "WHERE archived = 0"
        async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            cursor = await conn.execute(
                f"SELECT id FROM memory_items {archived_sql} ORDER BY pinned DESC, updated_at DESC LIMIT ?",
                (max(limit * 4, 20),),
            )
            ids = [row["id"] for row in await cursor.fetchall()]

    rows = await _get_memory_rows_by_ids(ids)
    scored: list[dict[str, Any]] = []
    for row in rows:
        memory = _row_to_memory(row)
        lexical = _lexical_similarity(query, memory["text"])
        vector = vector_scores.get(memory["id"], 0.0)
        score = (vector * 0.64) + (lexical * 0.36)
        score += 0.08 if memory["pinned"] else 0.0
        score += min(memory["use_count"], 20) * 0.0025
        score += memory["confidence"] * 0.025
        if memory["archived"] and not include_archived:
            continue
        if score >= min_relevance or lexical >= 0.16 or memory["pinned"]:
            memory["_score"] = round(score, 4)
            scored.append(memory)

    scored.sort(key=lambda item: (item["_score"], item["pinned"], item["updated_at"]), reverse=True)
    return scored[:limit]


async def mark_memories_used(memory_ids: list[str]) -> None:
    if not memory_ids:
        return
    now = _now()
    placeholders = ",".join("?" * len(memory_ids))
    async with aiosqlite.connect(app_db.DATABASE_PATH) as conn:
        await conn.execute(
            f"""
            UPDATE memory_items
            SET use_count = use_count + 1, last_used_at = ?, updated_at = updated_at
            WHERE id IN ({placeholders})
            """,
            (now, *memory_ids),
        )
        await conn.commit()


def _strip_internal(memory: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in memory.items() if not key.startswith("_")}


def memories_for_prompt(memories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_strip_internal(memory) for memory in memories[:MEMORY_CONTEXT_LIMIT]]


def _parse_json_array(raw: str) -> list[dict[str, Any]]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("[")
    end = raw.rfind("]")
    if start < 0 or end < start:
        return []
    try:
        parsed = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def _fallback_candidates(user_text: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for pattern in [
        r"\bmy name is ([A-Z][A-Za-z0-9 _'-]{1,60})",
        r"\bcall me ([A-Z][A-Za-z0-9 _'-]{1,60})",
        r"\bi(?:'m| am) ([^.!?\n]{4,140})",
        r"\bi (?:prefer|like|love|hate) ([^.!?\n]{3,160})",
        r"\bremember(?: that| this)?[:\s]+([^.!?\n]{4,220})",
    ]:
        for match in re.finditer(pattern, user_text, re.IGNORECASE):
            fragment = _normalize_text(match.group(0))
            if len(fragment) < 8:
                continue
            candidates.append(
                {
                    "text": fragment,
                    "kind": _classify_kind(fragment),
                    "topics": _infer_topics(fragment),
                    "entities": _infer_entities(fragment),
                    "confidence": 0.72,
                }
            )
    return candidates[:4]


async def extract_memory_candidates(user_text: str, assistant_text: str) -> list[dict[str, Any]]:
    prompt = f"""
Extract durable long-term memory candidates for a private local assistant.

Return ONLY a JSON array. Each item must have:
  text: one concise first-person-neutral sentence about the user, their preferences, projects, constraints, or stable instructions
  kind: one of semantic, preference, episodic, procedural
  topics: short lowercase tags
  entities: proper names, tools, projects, places, or organizations
  confidence: number from 0 to 1

Rules:
- Keep only information likely to help future chats across conversations.
- Prefer stable facts, preferences, working style, recurring projects, and explicit "remember" requests.
- Ignore one-off requests, generic conversation content, assistant claims, trivia, and transient details.
- Do not store highly sensitive information unless the user explicitly asked to remember it.
- If there is nothing worth remembering, return [].
- Limit to 5 items.

User message:
{user_text[:2500]}

Assistant response:
{assistant_text[:2500]}
""".strip()
    try:
        raw = await chat_completion(
            [{"role": "user", "content": prompt}],
            temperature=0.05,
            max_tokens=MEMORY_EXTRACT_MAX_TOKENS,
        )
    except Exception:
        return _fallback_candidates(user_text)

    parsed = _parse_json_array(raw)
    candidates: list[dict[str, Any]] = []
    for item in parsed[:5]:
        text = _normalize_text(str(item.get("text") or ""))
        if len(text) < 8 or len(text) > 420:
            continue
        kind = str(item.get("kind") or _classify_kind(text))
        if kind not in MEMORY_KINDS:
            kind = _classify_kind(text)
        confidence = item.get("confidence", 0.65)
        try:
            confidence_float = max(0.0, min(1.0, float(confidence)))
        except (TypeError, ValueError):
            confidence_float = 0.65
        if confidence_float < 0.45:
            continue
        candidates.append(
            {
                "text": text,
                "kind": kind,
                "topics": _clean_list(item.get("topics") or _infer_topics(text), limit=10),
                "entities": _clean_list(item.get("entities") or _infer_entities(text), limit=10),
                "confidence": confidence_float,
            }
        )
    return candidates or _fallback_candidates(user_text)


def _explicit_remember_fragments(user_text: str) -> list[str]:
    fragments: list[str] = []
    patterns = [
        r"\bremember(?: that| this)?[:\s]+(.+?)(?:$|[.!?]\s)",
        r"\bplease remember(?: that)?\s+(.+?)(?:$|[.!?]\s)",
        r"\bkeep in mind(?: that)?\s+(.+?)(?:$|[.!?]\s)",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, user_text, re.IGNORECASE | re.DOTALL):
            fragment = _normalize_text(match.group(1))
            if 4 <= len(fragment) <= 360:
                fragments.append(fragment)
    return _clean_list(fragments, limit=4)


def _forget_fragment(user_text: str) -> str | None:
    lowered = user_text.casefold().strip()
    if lowered.startswith("don't forget") or lowered.startswith("do not forget"):
        return None
    match = re.search(
        r"\b(?:forget|delete|remove)\b(?:\s+(?:the|my|that|this|a|any))?"
        r"(?:\s+memor(?:y|ies))?(?:\s+(?:about|that|of))?\s+(.+)",
        user_text,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None
    fragment = _normalize_text(match.group(1)).strip(".!?")
    return fragment if 3 <= len(fragment) <= 240 else None


async def process_user_memory_directives(
    conversation_id: str,
    user_message_id: int,
    user_text: str,
) -> dict[str, Any]:
    created: list[dict[str, Any]] = []
    archived: list[dict[str, Any]] = []

    forget = _forget_fragment(user_text)
    if forget:
        candidates = await retrieve_memories(forget, limit=8, include_archived=False, min_relevance=0.0)
        for memory in candidates:
            if _lexical_similarity(forget, memory["text"]) >= 0.14 or float(memory.get("_score", 0.0)) >= 0.22:
                updated = await update_memory(memory["id"], archived=True)
                if updated:
                    archived.append(updated)

    for fragment in _explicit_remember_fragments(user_text):
        created.append(
            await remember_text(
                fragment,
                kind=_classify_kind(fragment),
                topics=_infer_topics(fragment),
                entities=_infer_entities(fragment),
                confidence=0.95,
                pinned=True,
                source_conversation_id=conversation_id,
                source_message_id=user_message_id,
            )
        )

    return {"created": created, "archived": archived}


async def extract_and_store_turn(
    conversation_id: str,
    user_message_id: int,
    assistant_message_id: int,
    user_text: str,
    assistant_text: str,
) -> list[dict[str, Any]]:
    if not assistant_text.strip():
        return []
    async with _extract_semaphore:
        candidates = await extract_memory_candidates(user_text, assistant_text)
        stored: list[dict[str, Any]] = []
        for candidate in candidates:
            stored.append(
                await remember_text(
                    candidate["text"],
                    kind=candidate["kind"],
                    topics=candidate["topics"],
                    entities=candidate["entities"],
                    confidence=candidate["confidence"],
                    source_conversation_id=conversation_id,
                    source_message_id=user_message_id or assistant_message_id,
                )
            )
        return stored


def schedule_turn_extraction(
    conversation_id: str,
    user_message_id: int,
    assistant_message_id: int,
    user_text: str,
    assistant_text: str,
) -> None:
    async def runner() -> None:
        try:
            await extract_and_store_turn(
                conversation_id,
                user_message_id,
                assistant_message_id,
                user_text,
                assistant_text,
            )
        except Exception:
            return

    try:
        asyncio.create_task(runner())
    except RuntimeError:
        return


async def memory_graph(limit: int = 120) -> dict[str, Any]:
    memories = await list_memories(include_archived=False, limit=limit)
    nodes: dict[str, dict[str, Any]] = {
        "user": {"id": "user", "label": "You", "type": "user", "weight": 1.0}
    }
    edges: dict[str, dict[str, Any]] = {}

    def add_node(node_id: str, label: str, node_type: str, weight: float = 0.5) -> None:
        if node_id in nodes:
            nodes[node_id]["weight"] = min(1.0, nodes[node_id]["weight"] + weight * 0.18)
            return
        nodes[node_id] = {"id": node_id, "label": label, "type": node_type, "weight": weight}

    def add_edge(source: str, target: str, label: str, weight: float = 0.3) -> None:
        key = f"{source}->{target}:{label}"
        if key in edges:
            edges[key]["weight"] = min(1.0, edges[key]["weight"] + weight * 0.25)
            return
        edges[key] = {"source": source, "target": target, "label": label, "weight": weight}

    for memory in memories:
        memory_id = f"memory:{memory['id']}"
        label = memory["text"] if len(memory["text"]) <= 80 else memory["text"][:77].rstrip() + "..."
        add_node(memory_id, label, memory["kind"], max(0.25, memory["confidence"]))
        add_edge("user", memory_id, "remembers", 0.22)

        kind_id = f"kind:{memory['kind']}"
        add_node(kind_id, memory["kind"].title(), "kind", 0.55)
        add_edge(memory_id, kind_id, "kind", 0.28)

        linked_nodes: list[str] = []
        for topic in memory["topics"][:5]:
            topic_id = f"topic:{topic.casefold()}"
            add_node(topic_id, topic, "topic", 0.42)
            add_edge(memory_id, topic_id, "topic", 0.34)
            linked_nodes.append(topic_id)
        for entity in memory["entities"][:5]:
            entity_id = f"entity:{entity.casefold()}"
            add_node(entity_id, entity, "entity", 0.5)
            add_edge(memory_id, entity_id, "entity", 0.42)
            linked_nodes.append(entity_id)

        for index, left in enumerate(linked_nodes[:6]):
            for right in linked_nodes[index + 1 : 6]:
                add_edge(left, right, "co-occurs", 0.12)

    return {"nodes": list(nodes.values()), "edges": list(edges.values())}
