import { URL } from "node:url";
import {
  MAX_SEARCH_RESULTS,
  SEARCH_LANGUAGE,
  SEARCH_QUERY_VARIANTS,
  SEARCH_SAFESEARCH_DEFAULT,
  SEARCH_TIMEOUT_SECONDS,
  SEARXNG_BASE_URL,
} from "./config.js";

const STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "best",
  "but",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "get",
  "give",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "latest",
  "me",
  "more",
  "new",
  "news",
  "of",
  "on",
  "or",
  "please",
  "show",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "today",
  "up",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
  "you",
]);

const TOKEN_RE = /[a-z0-9][a-z0-9._+-]*/gi;
const RECENT_INTENT_RE = /\b(latest|recent|today|this week|breaking|news|current|202[4-9])\b/i;
const TRACKING_KEYS = new Set(["fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "ref", "ref_src", "spm"]);

export async function search(query, maxResults = MAX_SEARCH_RESULTS, options = {}) {
  const cleanQuery = query.replace(/\s+/g, " ").trim();
  if (!cleanQuery) return [];

  const variants = queryVariants(cleanQuery, options.variantCount ?? SEARCH_QUERY_VARIANTS);
  const batches = await Promise.allSettled(variants.map((variant) => searchSearxng(variant, options)));
  const failures = batches.filter((batch) => batch.status === "rejected");
  const results = batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));

  if (!results.length && failures.length) {
    throw failures[0].reason;
  }

  return rankAndDedupe(results, cleanQuery).slice(0, Math.max(1, maxResults));
}

export function queryVariants(query, maxVariants = SEARCH_QUERY_VARIANTS) {
  const cleaned = stripAssistantFraming(query);
  const variants = [cleaned];
  const compact = importantTokens(cleaned, 12).join(" ");
  if (compact && compact.toLowerCase() !== cleaned.toLowerCase()) variants.push(compact);
  if (RECENT_INTENT_RE.test(cleaned)) variants.push(`${compact || cleaned} ${new Date().getFullYear()}`);

  const seen = new Set();
  return variants
    .map((variant) => variant.replace(/\s+/g, " ").trim().slice(0, 320))
    .filter((variant) => {
      const key = variant.toLowerCase();
      if (!variant || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, maxVariants));
}

async function searchSearxng(query, options) {
  const url = new URL("/search", SEARXNG_BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  url.searchParams.set("safesearch", String(clampSafeSearch(options.safeSearch)));
  url.searchParams.set("pageno", "1");
  const timeRange = options.timeRange ?? inferTimeRange(query);
  if (timeRange) url.searchParams.set("time_range", timeRange);
  if (SEARCH_LANGUAGE && SEARCH_LANGUAGE !== "auto") url.searchParams.set("language", SEARCH_LANGUAGE);

  const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_SECONDS * 1000) });
  if (!response.ok) throw new Error(`SearXNG returned ${response.status}`);
  const data = await response.json();
  return (data.results || []).map(normalizeItem).filter(Boolean);
}

function normalizeItem(item, rank) {
  const url = absoluteUrl(item.url || "");
  if (!url) return null;
  const canonicalUrl = canonicalizeUrl(url);
  const parsed = new URL(canonicalUrl);
  const domain = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const title = oneLine(item.title || item.source || domain || canonicalUrl);
  const snippet = oneLine(item.content || item.snippet || "");
  const engines = Array.isArray(item.engines) ? item.engines : item.engine ? [item.engine] : [];
  return {
    title: title || canonicalUrl,
    url: canonicalUrl,
    snippet,
    kind: "web",
    source: item.source || engines.join(", ") || null,
    domain: domain || null,
    published_date: item.publishedDate || item.published_date || null,
    score: scoreItem({ item, queryTitle: title, snippet, domain, rank }),
  };
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

function absoluteUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return new URL(text, SEARXNG_BASE_URL).toString();
  } catch {
    return "";
  }
}

function rankAndDedupe(results, query) {
  const merged = new Map();
  for (const result of results) {
    const existing = merged.get(result.url);
    const score = result.score + overlapScore(query, result);
    const withScore = { ...result, score: Number(score.toFixed(3)) };
    if (!existing || withScore.score > existing.score) {
      merged.set(result.url, withScore);
    } else if (withScore.snippet && !existing.snippet.includes(withScore.snippet)) {
      existing.snippet = `${existing.snippet} ${withScore.snippet}`.trim().slice(0, 800);
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

function scoreItem({ item, queryTitle, snippet, domain, rank }) {
  const engineCount = Array.isArray(item.engines) ? item.engines.length : item.engine ? 1 : 0;
  const rawScore = Number(item.score || 0);
  let score = Math.log1p(Math.max(rawScore, 0)) * 1.5 + Math.min(engineCount, 4) * 0.35 + 1 / Math.max(rank + 1, 1);
  if (item.publishedDate || item.published_date) score += 0.2;
  if (queryTitle && queryTitle.toLowerCase() === domain.toLowerCase()) score -= 0.6;
  if (snippet) score += 0.25;
  return score;
}

function overlapScore(query, result) {
  const queryTokens = new Set(importantTokens(query, 24));
  const haystackTokens = new Set(importantTokens(`${result.title} ${result.snippet} ${result.domain}`, 80));
  let overlap = 0;
  for (const token of queryTokens) {
    if (haystackTokens.has(token)) overlap += 1;
  }
  return overlap * 1.15;
}

function stripAssistantFraming(query) {
  let text = query.trim();
  text = text.replace(/^(please\s+)?(can you|could you|would you)\s+/i, "");
  text = text.replace(/^(please\s+)?(search|look up|find|google|show me)\s+(for\s+)?/i, "");
  text = text.replace(/^the\s+/i, "");
  return text.replace(/[?.!]+$/g, "").trim() || query.trim();
}

function importantTokens(text, limit) {
  const tokens = [];
  for (const match of text.toLowerCase().matchAll(TOKEN_RE)) {
    const token = match[0];
    if (STOPWORDS.has(token) || token.length <= 1 || tokens.includes(token)) continue;
    tokens.push(token);
    if (tokens.length >= limit) break;
  }
  return tokens;
}

function inferTimeRange(query) {
  return RECENT_INTENT_RE.test(query) ? "year" : null;
}

function clampSafeSearch(value) {
  const raw = value == null ? SEARCH_SAFESEARCH_DEFAULT : Number(value);
  return Math.max(0, Math.min(2, Number.isFinite(raw) ? raw : SEARCH_SAFESEARCH_DEFAULT));
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
