import { MAX_DIRECT_URLS, MAX_PAGES_TO_READ } from "./config.js";
import { buildWebContext } from "./prompting.js";
import { canonicalizeUrl, extractHttpUrls, search, stripUrls } from "./search.js";
import { readPage } from "./page-reader.js";

export async function resolveSearchContext({ message, history = [], webEnabled = false, signal, emit = () => {}, searchFn = search } = {}) {
  const pageReads = [];
  let sources = [];
  let searchUnavailable = false;
  const directUrls = extractHttpUrls(message, MAX_DIRECT_URLS);

  if (directUrls.length) {
    emit("status", directUrls.length === 1 ? "Reading linked page..." : "Reading linked pages...");
    const direct = await readPages(directUrls, signal);
    pageReads.push(...direct.pages);
    sources = mergeSources(sources, direct.sources);
    for (const page of direct.pages) emit("page_read", page);
    for (const failure of direct.failures) emit("status", `Linked page failed: ${failure.url} (${failure.error})`);
    if (direct.sources.length) emit("search_results", sources);
  }

  const query = buildSearchQuery(message, history);
  if (webEnabled && query) {
    emit("status", "Searching web...");
    try {
      const results = await searchFn(query);
      sources = mergeSources(sources, results);
      if (sources.length) emit("search_results", sources);

      const remainingReads = Math.max(0, MAX_PAGES_TO_READ - pageReads.length);
      if (remainingReads > 0 && results.length) {
        emit("status", "Reading sources...");
        const readResults = await readSearchResults(results, pageReads, remainingReads, signal);
        pageReads.push(...readResults);
        for (const page of readResults) emit("page_read", page);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      searchUnavailable = true;
      emit("status", `Search failed: ${error.message}`);
    }
  }

  return {
    sources,
    pageReads,
    webContext: [
      searchUnavailable ? "Web search was unavailable for this request. Tell the user if current information cannot be verified; do not claim to have searched. Any linked page evidence below can still be used." : "",
      buildWebContext(sources, pageReads),
    ].filter(Boolean).join("\n\n"),
  };
}

function buildSearchQuery(message, history) {
  const current = cleanSearchText(message);
  const previousUser = [...history]
    .reverse()
    .find((item) => item.role === "user" && item.content && item.content !== message);
  const previous = previousUser ? cleanSearchText(previousUser.content) : "";

  if (current && previous && isReferential(current)) return compact(`${previous} ${current}`);
  return compact(current || previous);
}

async function readPages(urls, signal) {
  const settled = await Promise.allSettled(urls.map((url) => readPage(url, { signal })));
  const pages = [];
  const failures = [];
  const sources = [];

  settled.forEach((item, index) => {
    const url = urls[index];
    if (item.status === "fulfilled") {
      const page = { ...item.value, requested_url: item.value.requested_url || url };
      pages.push(page);
      sources.push(sourceFromPage(page, url, index));
    } else {
      failures.push({ url, error: item.reason?.message || String(item.reason) });
    }
  });

  return { pages, failures, sources };
}

async function readSearchResults(results, knownPages, maxPages, signal) {
  const known = new Set(knownPages.flatMap((page) => sourceUrlKeys(page.url, page.requested_url)));
  const toRead = [];

  for (const result of results) {
    if (!result.url) continue;
    const key = sourceUrlKey(result.url);
    if (known.has(key)) continue;
    known.add(key);
    toRead.push(result.url);
    if (toRead.length >= maxPages) break;
  }

  const settled = await Promise.allSettled(toRead.map((url) => readPage(url, { signal })));
  return settled.flatMap((item, index) =>
    item.status === "fulfilled" ? [{ ...item.value, requested_url: item.value.requested_url || toRead[index] }] : []
  );
}

function sourceFromPage(page, fallbackUrl, index) {
  const url = safeCanonicalUrl(page.url || fallbackUrl) || page.url || fallbackUrl;
  const domain = sourceDomain(url);
  const title = oneLine(page.title || domain || url);
  return {
    title: title || url,
    url,
    snippet: oneLine(page.excerpt).slice(0, 800),
    kind: "web",
    source: "direct link",
    domain,
    published_date: null,
    score: 100 - index,
  };
}

function mergeSources(...groups) {
  const merged = new Map();
  for (const result of groups.flat()) {
    if (!result?.url) continue;
    const key = sourceUrlKey(result.url);
    const existing = merged.get(key);
    if (!existing || Number(result.score || 0) > Number(existing.score || 0)) merged.set(key, result);
  }
  return [...merged.values()];
}

function cleanSearchText(value) {
  return stripUrls(value)
    .replace(/[<>\[\]()`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isReferential(value) {
  return /\b(it|its|that|this|they|them|those|these|he|she|his|her)\b/i.test(value);
}

function compact(value) {
  return oneLine(value).slice(0, 320);
}

function sourceUrlKeys(...values) {
  return values.flatMap((value) => {
    const key = sourceUrlKey(value);
    return key ? [key] : [];
  });
}

function sourceUrlKey(value) {
  return (safeCanonicalUrl(value) || String(value || "").trim()).toLowerCase();
}

function safeCanonicalUrl(value) {
  try {
    return canonicalizeUrl(String(value || ""));
  } catch {
    return "";
  }
}

function sourceDomain(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
