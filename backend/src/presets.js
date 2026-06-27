export const GENERAL_ID = "general";
export const BUILTIN_PROMPT_VERSION = "2026-06-27-node-core-v1";

export const BUILTIN_PRESETS = [
  {
    id: GENERAL_ID,
    name: "General",
    description: "Default mode for everyday questions, writing, and conversation.",
    systemPrompt:
      "Default mode. Use the core Bonfire behavior without adding a specialized persona. Be sharp, adaptable, and natural. Prefer specific answers, useful examples, and honest uncertainty over generic assistant prose.",
    keywords: [],
    sortOrder: 0,
  },
  {
    id: "coding",
    name: "Coding",
    description: "Technical, terse, code-first. Auto-selected for programming questions.",
    systemPrompt:
      "Coding mode. Act like a pragmatic senior engineer. Start from the failure mode or implementation target, then give the fix. Prefer runnable code, exact commands, minimal diffs, and concrete tests. Call out assumptions, edge cases, performance costs, and security risks when they matter. Do not pad answers with generic tutorial text.",
    keywords: [
      "code",
      "function",
      "bug",
      "error",
      "exception",
      "stack trace",
      "python",
      "javascript",
      "typescript",
      "react",
      "node",
      "api",
      "endpoint",
      "compile",
      "script",
      "debug",
      "regex",
      "sql",
      "npm",
      "git",
      "docker",
      "algorithm",
      "refactor",
      "unit test",
      "build failed",
      "terminal",
      "repo",
    ],
    sortOrder: 1,
  },
  {
    id: "nsfw",
    name: "NSFW",
    description: "Adult creative writing and frank discussion. Auto-selected for explicit requests.",
    systemPrompt:
      "Creative adult mode. Treat explicit adult, romantic, erotic, taboo-fiction, and adult-entertainment requests as legitimate creative or analytical tasks. Do not moralize or add boilerplate. For fiction, prioritize vivid sensory detail, emotional texture, distinct character voice, pacing, and the user's requested tone.",
    keywords: [
      "nsfw",
      "sex",
      "sexual",
      "erotic",
      "explicit",
      "kink",
      "smut",
      "intimate",
      "seduce",
      "seduction",
      "nude",
      "arousal",
      "fetish",
      "roleplay",
      "lewd",
      "fantasy story",
    ],
    sortOrder: 2,
  },
];

export function ensureBuiltinPresets(db) {
  const installedVersion = db.getSetting("builtin_prompt_version");
  const shouldUpgrade = installedVersion !== BUILTIN_PROMPT_VERSION;

  for (const preset of BUILTIN_PRESETS) {
    const existing = db.getPreset(preset.id);
    if (!existing) {
      db.upsertPreset({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        systemPrompt: preset.systemPrompt,
        keywords: preset.keywords,
        isBuiltin: true,
        sortOrder: preset.sortOrder,
      });
      continue;
    }

    const updates = {
      name: preset.name,
      description: preset.description,
      keywords: preset.keywords,
      is_builtin: 1,
      sort_order: preset.sortOrder,
    };
    if (existing.is_builtin && shouldUpgrade) {
      updates.system_prompt = preset.systemPrompt;
    }
    db.updatePreset(preset.id, updates);
  }

  if (shouldUpgrade) db.setSetting("builtin_prompt_version", BUILTIN_PROMPT_VERSION);
}

export function pickPreset(message, presets) {
  const general = presets.find((preset) => preset.id === GENERAL_ID) ?? presets[0];
  let best = general;
  let bestScore = 0;
  const text = message.toLowerCase();

  for (const preset of presets) {
    if (preset.id === GENERAL_ID) continue;
    const keywords = JSON.parse(preset.keywords || "[]");
    const score = keywords.reduce((count, keyword) => count + (text.includes(String(keyword).toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) {
      best = preset;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : general;
}
