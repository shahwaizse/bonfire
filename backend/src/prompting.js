import { MAX_HISTORY_CHARS, MAX_HISTORY_TOKENS } from "./config.js";

export const CORE_SYSTEM_PROMPT = `You are Bonfire, a general-purpose local AI assistant.
Answer directly; expand when useful.
You can draft code, write text, explain and debug in chat. These abilities do not require tools or file-write permissions. Give runnable code and concrete fixes.
Use native tool calls for actions or evidence; wait for results, then answer using them. Discover unknown file paths/IDs before dependent calls. Use known IDs directly.
Use history for context. MCP means Model Context Protocol: it connects AI clients to tools and data servers.`;

export function buildSystemPrompt({ webEnabled = false, allowedTools, guy } = {}) {
  const has = name => !allowedTools || allowedTools.includes(name);
  return [
    guy ? `You are ${guy.name}, a little guy in Bonfire. ${guy.tagline}\n\nOwner's instructions:\n${guy.instructions}\n\nThese instructions define your focus and response style on every turn, including greetings and follow-ups. Respond as this little guy, applying the current instructions rather than imitating earlier generic assistant replies.\n\n${CORE_SYSTEM_PROMPT.split('\n').slice(1).join('\n')}` : CORE_SYSTEM_PROMPT,
    'Select tools for the current request: conversation can be answered in text; fetching pictures needs an image-search result. A tool being available is not itself a request to use it.',
    has('desktop__launch_app') && guy ? 'The app launcher takes app IDs. launch_requested means the launch request was sent; window status is not measured.' : '',
    has('files__list_folders') && guy ? 'Filesystem paths are relative to the assigned ROOT, never the last directory listed. Include the user-requested subdirectory in every path. Use known folder IDs directly or discover them with files__list_folders; supplied filenames can be read directly. Read existing files before changing them, then use the returned SHA256 as expected_hash. Text after "File content (raw):" is literal file content; line ranges are separate metadata. old_text/new_text accept multiline blocks; preserve surrounding text in both to target repeated values. Page reads using next_line. Write/edit results include a verified hash and backup ID; report actual results.' : '',
    has('files__run_command') && guy ? 'Bash command paths resolve relative to the supplied working directory: with path="demo", run node server.cjs, not node demo/server.cjs. For persistent apps use mode=start with a foreground command (no nohup or &). Keep returned process_id; use mode=status for logs/running state and mode=stop to stop its tree. mode=status without process_id lists your managed launches in that folder. For older unmanaged launches inspect existing PID/log files and native OS process/port information. Check exit_code/output/timed_out; empty failed searches do not prove shutdown. Verify the app URL after starting/stopping. You CAN check HTTP status and body through a Node command using built-in fetch; this needs no browser or installed package. Use it or read_webpage for requested URL checks instead of asking the user to check.' : '',
    `Runtime context: OS=${process.platform}; shell=${process.platform === 'win32' ? 'Git Bash on Windows, not Linux/WSL. ps may omit native Windows apps; lsof is not installed. Use PowerShell Get-CimInstance/Get-NetTCPConnection for unmanaged processes.' : 'Bash'}. Bonfire uses llama.cpp, Node.js ${process.versions.node}, Express, React, SQLite and optional hosted search.`,
    `Web search toggle is ${webEnabled ? 'ON: search_web is available for current facts and source/verification requests.' : 'OFF: search_web is unavailable in this request.'}`,
    has('read_webpage') ? 'read_webpage can read supplied links regardless of Web. Cite web/page evidence using returned [1], [2] numbers.' : '',
    has('search_images') ? 'For requested pictures, call search_images with the subject from history. Bonfire displays the pictures below your reply automatically. Introduce them briefly in plain text; do not write gallery tags or placeholders. Image results have no citation numbers.' : '',
    // Changing data comes last so it cannot invalidate the stable instruction prefix.
    `Current local date: ${new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}.`,
  ].filter(Boolean).join("\n");
}

// Qwen permits one system message at the start. Keep runtime/evidence in it.
export function buildChatMessages({ history, webContext = '', webEnabled = false, allowedTools, guy }) {
  const system = [buildSystemPrompt({ webEnabled, allowedTools, guy }), webContext].filter(Boolean).join('\n\n');
  return [{ role: 'system', content: system }, ...selectRecentHistory(history).filter(message => message.role !== 'system')];
}

export async function selectTokenHistory(history, countTokens, { signal, budget = MAX_HISTORY_TOKENS } = {}) {
  const selected = []; let used = 0;
  for (const message of [...history].reverse()) {
    if (!['user', 'assistant'].includes(message.role)) continue;
    signal?.throwIfAborted();
    const content = String(message.content || '');
    const cost = await countTokens(content, { signal }) + 8;
    if (selected.length && used + cost > budget) break;
    selected.push({ role: message.role, content }); used += cost;
  }
  // Never leave an orphan assistant at the beginning after truncating history.
  const ordered = selected.reverse();
  if (ordered[0]?.role === 'assistant') ordered.shift();
  return ordered;
}

export function selectRecentHistory(messages, maxChars = MAX_HISTORY_CHARS) {
  const selected = [];
  let used = 0;

  for (const message of [...messages].reverse()) {
    if (!["user", "assistant", "system"].includes(message.role)) continue;
    const content = String(message.content || "");
    const cost = content.length + 32;
    if (selected.length && used + cost > maxChars) break;
    selected.push({ role: message.role, content });
    used += cost;
  }

  return selected.reverse();
}

export function buildWebContext(results, pageReads) {
  const webResults = results.filter((result) => (result.kind || "web") === "web").slice(0, 8);
  if (!webResults.length && !pageReads.length) return "";

  const pageByUrl = new Map();
  for (const page of pageReads) {
    for (const key of urlKeys(page.url, page.requested_url)) {
      if (!pageByUrl.has(key)) pageByUrl.set(key, page);
    }
  }

  const lines = [
    "Retrieved web context follows. Cite sources inline as [1], [2], etc. when relying on it.",
    "",
    "Sources:",
  ];

  webResults.forEach((result, index) => {
    const page = pageByUrl.get(urlKey(result.url));
    lines.push(`[${index + 1}] ${result.title || "Untitled"}`);
    lines.push(`URL: ${result.url}`);
    if (result.domain) lines.push(`Domain: ${result.domain}`);
    if (result.snippet) lines.push(`Snippet: ${oneLine(result.snippet)}`);
    if (page?.excerpt) lines.push(`Page excerpt: ${oneLine(page.excerpt)}`);
    lines.push("");
  });

  return lines.join("\n").trim();
}

function urlKeys(...values) {
  return values.flatMap((value) => {
    const key = urlKey(value);
    return key ? [key] : [];
  });
}

function urlKey(value) {
  try {
    const parsed = new URL(String(value || ""));
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return String(value || "").trim();
  }
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
