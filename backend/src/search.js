import { URL } from "node:url";
import { MAX_SEARCH_RESULTS } from "./config.js";
import { providerSearch } from "./search-providers.js";
import { ResultCache } from './result-cache.js';
const searchCache = new ResultCache({ ttlMs: 30000 });

const EXPLICIT_URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const BARE_DOMAIN_RE = /(?:^|[\s(<\[{])((?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"'`]*)?)/gi;
const NON_URL_SUFFIXES = new Set(["c", "cpp", "css", "go", "h", "js", "json", "md", "py", "rs", "ts", "tsx", "txt"]);
const TRACKING_KEYS = new Set(["fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "ref", "ref_src", "spm"]);

export async function search(query, maxResults = MAX_SEARCH_RESULTS, searchProvider = providerSearch, { signal } = {}) {
  const cleanQuery = normalizeQuery(query);
  if (!cleanQuery) return [];

  const count = Math.max(1, Math.min(20, Math.floor(Number(maxResults) || MAX_SEARCH_RESULTS)));
  signal?.throwIfAborted();
  const key = JSON.stringify([cleanQuery, count]);
  const cached = searchProvider === providerSearch ? searchCache.get(key) : null;
  if (cached) return cached.map(result => ({ ...result, cached: true }));
  const results = await searchProvider(cleanQuery, count, { signal });
  const normalized = rankAndDedupe(results.map(normalizeItem).filter(Boolean), cleanQuery).slice(0, count).map(result => ({ ...result, retrieved_at: new Date().toISOString() }));
  if (searchProvider === providerSearch && normalized.length) searchCache.set(key, normalized);
  return normalized;
}

export function extractHttpUrls(text, maxUrls = 10) {
  const seen = new Set();
  const urls = [];

  for (const match of urlMatches(text)) {
    const url = normalizeExtractedUrl(match.raw);
    const key = url.toLowerCase();
    if (!url || seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
    if (urls.length >= maxUrls) break;
  }

  return urls;
}

export function stripUrls(text) {
  const value = String(text || "").replace(/\[([^\]]+)\]\(\s*((?:https?:\/\/|www\.)[^)\s]+)\s*\)/gi, "$1");
  const matches = urlMatches(value);
  if (!matches.length) return oneLine(value).replace(/\s*,\s*/g, " ");

  let stripped = "";
  let offset = 0;
  for (const match of matches) {
    stripped += value.slice(offset, match.start);
    stripped += " ";
    offset = match.end;
  }
  stripped += value.slice(offset);

  return oneLine(stripped).replace(/\s*,\s*/g, " ");
}

export function canonicalizeUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (TRACKING_KEYS.has(lower) || lower.startsWith("utm_")) parsed.searchParams.delete(key);
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

function normalizeQuery(value) {
  return stripAssistantFraming(stripUrls(value)).slice(0, 320);
}

function normalizeItem(item, index) {
  const url = absoluteUrl(item.url || "");
  if (!url) return null;

  const canonicalUrl = canonicalizeUrl(url);
  const parsed = new URL(canonicalUrl);
  const domain = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const engines = Array.isArray(item.engines) ? item.engines : item.engine ? [item.engine] : [];
  const title = oneLine(item.title || item.source || domain || canonicalUrl);
  const snippet = oneLine(item.content || item.snippet || "");

  return {
    title: title || canonicalUrl,
    url: canonicalUrl,
    snippet,
    kind: "web",
    source: item.source || engines.join(", ") || null,
    domain: domain || null,
    published_date: item.publishedDate || item.published_date || null,
    score: Number(item.score || 0) + engines.length * 0.3 + 1 / Math.max(index + 1, 1),
  };
}

function rankAndDedupe(results, query) {
  const merged = new Map();
  for (const result of results) {
    const score = result.score + overlapScore(query, result);
    const existing = merged.get(result.url);
    if (!existing || score > existing.score) merged.set(result.url, { ...result, score: Number(score.toFixed(3)) });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

function overlapScore(query, result) {
  const queryTerms = importantTerms(query);
  if (!queryTerms.length) return 0;

  const haystack = `${result.title} ${result.snippet} ${result.domain}`.toLowerCase();
  return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function importantTerms(text) {
  const stop = new Set([
    "a",
    "about",
    "and",
    "are",
    "for",
    "from",
    "how",
    "i",
    "is",
    "it",
    "latest",
    "me",
    "of",
    "on",
    "or",
    "search",
    "the",
    "to",
    "what",
    "when",
    "where",
    "who",
    "why",
  ]);
  return [...String(text || "").toLowerCase().matchAll(/[a-z0-9][a-z0-9._+-]*/g)]
    .map((match) => match[0])
    .filter((term, index, terms) => term.length > 1 && !stop.has(term) && terms.indexOf(term) === index)
    .slice(0, 16);
}

function urlMatches(value) {
  const text = String(value || "");
  const matches = [];

  for (const match of text.matchAll(EXPLICIT_URL_RE)) {
    matches.push({ raw: match[0], start: match.index, end: match.index + match[0].length });
  }

  for (const match of text.matchAll(BARE_DOMAIN_RE)) {
    const raw = match[1];
    if (!isBareDomainLikelyUrl(raw)) continue;
    const start = match.index + match[0].lastIndexOf(raw);
    const end = start + raw.length;
    if (!matches.some((existing) => start < existing.end && end > existing.start)) {
      matches.push({ raw, start, end });
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

function isBareDomainLikelyUrl(value) {
  const text = trimUrlCandidate(value);
  if (text.includes("/") || text.includes(":")) return true;
  const suffix = text.toLowerCase().split(".").at(-1);
  return suffix && !NON_URL_SUFFIXES.has(suffix);
}

function normalizeExtractedUrl(value) {
  let text = trimUrlCandidate(value);
  if (!text) return "";
  if (/^www\./i.test(text)) text = `https://${text}`;
  if (!/^https?:\/\//i.test(text) && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+/i.test(text)) text = `https://${text}`;

  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return canonicalizeUrl(parsed.toString());
  } catch {
    return "";
  }
}

function trimUrlCandidate(value) {
  let text = String(value || "")
    .trim()
    .replace(/^[<([{'"`]+/, "");

  while (text && ".,!?;:'\"`>".includes(text.at(-1))) text = text.slice(0, -1);
  while (text.endsWith(")") && countChar(text, ")") > countChar(text, "(")) text = text.slice(0, -1);
  while (text.endsWith("]") && countChar(text, "]") > countChar(text, "[")) text = text.slice(0, -1);
  return text;
}

function absoluteUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function stripAssistantFraming(query) {
  let text = oneLine(query);
  text = text.replace(/^(please\s+)?(can you|could you|would you)\s+/i, "");
  text = text.replace(/^(please\s+)?(search|look up|find|google|show me)\s+(for\s+)?/i, "");
  text = text.replace(/^the\s+/i, "");
  return text.replace(/[?.!]+$/g, "").trim();
}

function countChar(value, char) {
  return [...String(value || "")].filter((candidate) => candidate === char).length;
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
