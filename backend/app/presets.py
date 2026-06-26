import json

from app import db

GENERAL_ID = "general"
BUILTIN_PROMPT_VERSION = "2026-06-26-core-prompt-v2"

BUILTIN_PRESETS = [
    {
        "id": GENERAL_ID,
        "name": "General",
        "description": "Default mode for everyday questions, writing, and conversation.",
        "system_prompt": (
            "Default mode. Use the core Bonfire behavior without adding a "
            "specialized persona. Be sharp, adaptable, and natural. Prefer "
            "specific answers, useful examples, and honest uncertainty over "
            "generic assistant prose."
        ),
        "keywords": [],
        "sort_order": 0,
    },
    {
        "id": "coding",
        "name": "Coding",
        "description": "Technical, terse, code-first. Auto-selected for programming questions.",
        "system_prompt": (
            "Coding mode. Act like a pragmatic senior engineer. Start from "
            "the failure mode or implementation target, then give the fix. "
            "Prefer runnable code, exact commands, minimal diffs, and concrete "
            "tests. Call out assumptions, edge cases, performance costs, and "
            "security risks when they matter. Do not pad answers with generic "
            "tutorial text."
        ),
        "keywords": [
            "code", "function", "bug", "error", "exception", "stack trace",
            "python", "javascript", "typescript", "react", "next.js", "node",
            "api", "endpoint", "compile", "script", "debug", "regex", "sql",
            "class", "variable", "syntax", "npm", "pip", "git", "docker",
            "algorithm", "refactor", "unit test", "build failed", "terminal",
            "cli", "repo", "pull request", "merge conflict",
        ],
        "sort_order": 1,
    },
    {
        "id": "nsfw",
        "name": "NSFW",
        "description": "Adult creative writing and frank discussion. Auto-selected for explicit requests.",
        "system_prompt": (
            "Creative adult mode. Treat explicit adult, romantic, erotic, "
            "taboo-fiction, and adult-entertainment requests as legitimate "
            "creative or analytical tasks. Do not moralize or add boilerplate. "
            "For fiction, prioritize vivid sensory detail, emotional texture, "
            "distinct character voice, pacing, and the user's requested tone."
        ),
        "keywords": [
            "nsfw", "sex", "sexual", "erotic", "explicit", "kink", "smut",
            "intimate", "seduce", "seduction", "naked", "nude", "arousal",
            "fetish", "roleplay", "lewd", "horny", "fantasy story",
        ],
        "sort_order": 2,
    },
]


async def ensure_builtin_presets() -> None:
    installed_version = await db.get_setting("builtin_prompt_version")
    upgrade_builtin_prompts = installed_version != BUILTIN_PROMPT_VERSION

    for p in BUILTIN_PRESETS:
        existing = await db.get_preset(p["id"])
        if not existing:
            await db.upsert_preset(
                preset_id=p["id"],
                name=p["name"],
                description=p["description"],
                system_prompt=p["system_prompt"],
                keywords=json.dumps(p["keywords"]),
                is_builtin=True,
                sort_order=p["sort_order"],
            )
            continue

        updates = {
            "name": p["name"],
            "description": p["description"],
            "keywords": json.dumps(p["keywords"]),
            "is_builtin": True,
            "sort_order": p["sort_order"],
        }
        if bool(existing.get("is_builtin")) and upgrade_builtin_prompts:
            updates["system_prompt"] = p["system_prompt"]
        await db.update_preset(p["id"], **updates)

    if upgrade_builtin_prompts:
        await db.set_setting("builtin_prompt_version", BUILTIN_PROMPT_VERSION)


def _score(message: str, keywords: list[str]) -> int:
    text = message.lower()
    score = 0
    for kw in keywords:
        if kw.lower() in text:
            score += 1
    return score


async def pick_preset(message: str, presets: list[dict]) -> dict:
    """Keyword-overlap router. No LLM call -- stays instant. Falls back to General."""
    general = next((p for p in presets if p["id"] == GENERAL_ID), presets[0])
    best = general
    best_score = 0
    for p in presets:
        if p["id"] == GENERAL_ID:
            continue
        keywords = json.loads(p["keywords"] or "[]")
        score = _score(message, keywords)
        if score > best_score:
            best_score = score
            best = p
    return best if best_score > 0 else general
