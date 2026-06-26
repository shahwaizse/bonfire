import os
import uuid
from datetime import datetime, timezone

import aiosqlite

from app.config import DATABASE_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    preset_id TEXT,
    sources TEXT,
    memory_ids TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    keywords TEXT NOT NULL,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_items (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    kind TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'user',
    topics TEXT NOT NULL DEFAULT '[]',
    entities TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0.7,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    source_conversation_id TEXT,
    source_message_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (source_conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (source_message_id) REFERENCES messages(id)
);

CREATE INDEX IF NOT EXISTS idx_memory_items_archived_updated
    ON memory_items (archived, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_items_source_conversation
    ON memory_items (source_conversation_id);

"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def init_db() -> None:
    os.makedirs(os.path.dirname(DATABASE_PATH) or ".", exist_ok=True)
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.executescript(SCHEMA)
        await db.commit()
        await _migrate(db)


async def _migrate(db: aiosqlite.Connection) -> None:
    """CREATE TABLE IF NOT EXISTS doesn't add columns to a table that already
    existed before this column was introduced -- patch those in by hand."""
    cursor = await db.execute("PRAGMA table_info(messages)")
    columns = {row[1] for row in await cursor.fetchall()}
    if "preset_id" not in columns:
        await db.execute("ALTER TABLE messages ADD COLUMN preset_id TEXT")
        await db.commit()
    if "sources" not in columns:
        await db.execute("ALTER TABLE messages ADD COLUMN sources TEXT")
        await db.commit()
    if "memory_ids" not in columns:
        await db.execute("ALTER TABLE messages ADD COLUMN memory_ids TEXT")
        await db.commit()

    cursor = await db.execute("PRAGMA table_info(conversations)")
    columns = {row[1] for row in await cursor.fetchall()}
    if "folder" not in columns:
        await db.execute("ALTER TABLE conversations ADD COLUMN folder TEXT NOT NULL DEFAULT ''")
        await db.commit()


# ---------------------------------------------------------------- conversations


async def create_conversation(title: str) -> str:
    conversation_id = str(uuid.uuid4())
    now = _now()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            "INSERT INTO conversations (id, title, folder, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
            (conversation_id, title, now, now),
        )
        await db.commit()
    return conversation_id


async def touch_conversation(conversation_id: str) -> None:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (_now(), conversation_id),
        )
        await db.commit()


async def add_message(
    conversation_id: str,
    role: str,
    content: str,
    preset_id: str | None = None,
    sources: str | None = None,
    memory_ids: str | None = None,
) -> int:
    now = _now()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO messages (conversation_id, role, content, preset_id, sources, memory_ids, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (conversation_id, role, content, preset_id, sources, memory_ids, now),
        )
        await db.commit()
        return cursor.lastrowid


async def get_conversation_messages(conversation_id: str) -> list[dict]:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, role, content, preset_id, sources, memory_ids, created_at FROM messages "
            "WHERE conversation_id = ? ORDER BY id ASC",
            (conversation_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_conversation(conversation_id: str) -> dict | None:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, title, folder, created_at, updated_at FROM conversations WHERE id = ?",
            (conversation_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def list_conversations() -> list[dict]:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, title, folder, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def update_conversation(conversation_id: str, **fields) -> dict | None:
    allowed = {"title", "folder"}
    fields = {key: value for key, value in fields.items() if key in allowed and value is not None}
    if not fields:
        return await get_conversation(conversation_id)

    fields["updated_at"] = _now()
    columns = ", ".join(f"{key} = ?" for key in fields)
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(f"UPDATE conversations SET {columns} WHERE id = ?", (*fields.values(), conversation_id))
        await db.commit()
    return await get_conversation(conversation_id)


async def delete_conversation(conversation_id: str) -> None:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
        await db.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        await db.commit()


# ---------------------------------------------------------------- settings


async def get_setting(key: str, default: str | None = None) -> str | None:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        return row[0] if row else default


async def get_settings(keys: list[str]) -> dict[str, str | None]:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            f"SELECT key, value FROM settings WHERE key IN ({','.join('?' * len(keys))})", keys
        )
        rows = await cursor.fetchall()
        found = {row["key"]: row["value"] for row in rows}
        return {k: found.get(k) for k in keys}


async def set_setting(key: str, value: str) -> None:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await db.commit()


# ---------------------------------------------------------------- presets


async def list_presets() -> list[dict]:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM presets ORDER BY sort_order ASC, created_at ASC")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_preset(preset_id: str) -> dict | None:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM presets WHERE id = ?", (preset_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def upsert_preset(
    preset_id: str,
    name: str,
    description: str,
    system_prompt: str,
    keywords: str,
    is_builtin: bool = False,
    sort_order: int = 100,
) -> None:
    now = _now()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            """
            INSERT INTO presets (id, name, description, system_prompt, keywords, is_builtin, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            (preset_id, name, description, system_prompt, keywords, int(is_builtin), sort_order, now, now),
        )
        await db.commit()


async def update_preset(preset_id: str, **fields) -> None:
    if not fields:
        return
    fields["updated_at"] = _now()
    columns = ", ".join(f"{k} = ?" for k in fields)
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(f"UPDATE presets SET {columns} WHERE id = ?", (*fields.values(), preset_id))
        await db.commit()


async def delete_preset(preset_id: str) -> None:
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("DELETE FROM presets WHERE id = ? AND is_builtin = 0", (preset_id,))
        await db.commit()
