from __future__ import annotations

import asyncio
import math
import re
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx

from app.config import (
    MAX_SEARCH_RESULTS,
    SEARCH_IMAGE_RESULTS,
    SEARCH_LANGUAGE,
    SEARCH_QUERY_VARIANTS,
    SEARCH_SAFESEARCH_DEFAULT,
    SEARCH_TIMEOUT_SECONDS,
    SEARXNG_BASE_URL,
)


STOPWORDS = {
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
}

IMAGE_INTENT_RE = re.compile(
    r"\b("
    r"album art|avatar|diagram|gif|image|images|infographic|logo|meme|"
    r"photo|photos|picture|pictures|screenshot|screenshots|show me|"
    r"visual|wallpaper|what does .+ look like"
    r")\b",
    re.IGNORECASE,
)
RECENT_INTENT_RE = re.compile(r"\b(latest|recent|today|this week|breaking|news|current|202[4-9])\b", re.IGNORECASE)
TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9._+-]*", re.IGNORECASE)
TRACKING_QUERY_KEYS = {
    "fbclid",
    "gclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "ref",
    "ref_src",
    "spm",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
}


@dataclass(frozen=True)
class SearchOptions:
    max_results: int
    include_images: bool
    image_results: int
    safe_search: int
    time_range: str | None
    language: str
    variant_count: int


def wants_image_results(query: str) -> bool:
    """Return True when the user's query is likely asking for visual results."""
    return bool(IMAGE_INTENT_RE.search(query))


def infer_time_range(query: str) -> str | None:
    """Use SearXNG's recency filter only when the user signals freshness."""
    return "year" if RECENT_INTENT_RE.search(query) else None


async def search(
    query: str,
    max_results: int | None = None,
    *,
    include_images: bool | None = None,
    safe_search: int | None = None,
    time_range: str | None = None,
) -> list[dict]:
    """Search SearXNG and return ranked web/image results.

    Bonfire intentionally keeps search local through SearXNG. The quality jump
    comes from query variants, category-specific retrieval, URL canonicalization,
    dedupe, and local reranking before the LLM sees evidence.
    """
    query = " ".join(query.split())
    if not query:
        return []

    opts = SearchOptions(
        max_results=max(1, max_results or MAX_SEARCH_RESULTS),
        include_images=wants_image_results(query) if include_images is None else include_images,
        image_results=max(0, SEARCH_IMAGE_RESULTS),
        safe_search=_clamp_safe_search(safe_search),
        time_range=time_range if time_range is not None else infer_time_range(query),
        language=SEARCH_LANGUAGE,
        variant_count=max(1, SEARCH_QUERY_VARIANTS),
    )

    query_variants = _query_variants(query, opts.variant_count)
    async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT_SECONDS) as client:
        tasks = [_search_category(client, variant, "general", opts) for variant in query_variants]
        if opts.include_images and opts.image_results:
            tasks.append(_search_category(client, query_variants[0], "images", opts))

        batches = await asyncio.gather(*tasks)

    web_results: list[dict] = []
    image_results: list[dict] = []
    for batch in batches:
        for result in batch:
            if result["kind"] == "image":
                image_results.append(result)
            else:
                web_results.append(result)

    ranked_web = _rank_and_dedupe(web_results, query, limit=opts.max_results)
    ranked_images = _rank_and_dedupe(image_results, query, limit=opts.image_results)
    return ranked_web + ranked_images


async def _search_category(
    client: httpx.AsyncClient,
    query: str,
    category: str,
    opts: SearchOptions,
) -> list[dict]:
    params = {
        "q": query,
        "format": "json",
        "categories": category,
        "safesearch": str(opts.safe_search),
        "pageno": "1",
    }
    if opts.language and opts.language != "auto":
        params["language"] = opts.language
    if opts.time_range:
        params["time_range"] = opts.time_range

    resp = await client.get(f"{SEARXNG_BASE_URL}/search", params=params)
    resp.raise_for_status()
    data = resp.json()
    results = []
    for rank, item in enumerate(data.get("results") or [], start=1):
        normalized = _normalize_item(item, category=category, query=query, rank=rank)
        if normalized:
            results.append(normalized)
    return results


def _clamp_safe_search(value: int | None) -> int:
    if value is None:
        value = SEARCH_SAFESEARCH_DEFAULT
    return max(0, min(2, int(value)))


def _query_variants(query: str, max_variants: int) -> list[str]:
    cleaned = _strip_assistant_framing(query)
    variants = [cleaned]

    compact = _compact_query(cleaned)
    if compact and compact.lower() != cleaned.lower():
        variants.append(compact)

    quoted_phrases = re.findall(r'"([^"]{3,80})"', cleaned)
    if quoted_phrases:
        variants.append(" ".join(quoted_phrases + _important_tokens(cleaned, limit=5)))

    if RECENT_INTENT_RE.search(cleaned):
        year_variant = f"{compact or cleaned} {datetime.now().year}"
        variants.append(year_variant)

    deduped: list[str] = []
    seen = set()
    for variant in variants:
        variant = " ".join(variant.split())[:320]
        key = variant.casefold()
        if variant and key not in seen:
            deduped.append(variant)
            seen.add(key)
        if len(deduped) >= max_variants:
            break
    return deduped or [query[:320]]


def _strip_assistant_framing(query: str) -> str:
    text = query.strip()
    text = re.sub(r"^(please\s+)?(can you|could you|would you)\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^(please\s+)?(search|look up|find|google|show me)\s+(for\s+)?", "", text, flags=re.IGNORECASE)
    return text.strip(" \t\r\n?.!") or query.strip()


def _compact_query(query: str) -> str:
    tokens = _important_tokens(query, limit=12)
    if len(tokens) < 3:
        return ""
    return " ".join(tokens)


def _important_tokens(text: str, *, limit: int) -> list[str]:
    tokens = []
    for token in TOKEN_RE.findall(text.lower()):
        if token in STOPWORDS or len(token) <= 1:
            continue
        if token not in tokens:
            tokens.append(token)
        if len(tokens) >= limit:
            break
    return tokens


def _normalize_item(item: dict, *, category: str, query: str, rank: int) -> dict | None:
    item_kind = "image" if category == "images" or item.get("img_src") else "web"
    image_url = _absolute_url(item.get("img_src") or item.get("image") or "")
    thumbnail_url = _absolute_url(item.get("thumbnail") or item.get("thumbnail_src") or image_url)
    url = _absolute_url(item.get("url") or (image_url if item_kind == "image" else ""))
    if not url:
        return None

    canonical_url = _canonicalize_url(url)
    parsed = urlparse(canonical_url)
    domain = parsed.netloc.lower().removeprefix("www.")
    title = " ".join((item.get("title") or item.get("source") or domain or url).split())
    snippet = " ".join((item.get("content") or item.get("snippet") or "").split())
    width, height = _parse_resolution(item.get("resolution"))
    engine_names = item.get("engines") or []
    if isinstance(engine_names, str):
        engine_names = [engine_names]

    normalized = {
        "kind": item_kind,
        "title": title or url,
        "url": canonical_url,
        "snippet": snippet,
        "source": item.get("source") or item.get("engine") or (", ".join(engine_names) if engine_names else None),
        "domain": domain or None,
        "thumbnail_url": thumbnail_url if item_kind == "image" else None,
        "image_url": image_url if item_kind == "image" else None,
        "width": width,
        "height": height,
        "published_date": _stringify_date(item.get("publishedDate") or item.get("published_date")),
        "_rank": rank,
        "_engines": engine_names,
        "_score": _score_item(item, query=query, title=title, snippet=snippet, domain=domain, rank=rank),
    }
    if item_kind == "image" and not normalized["thumbnail_url"]:
        normalized["thumbnail_url"] = normalized["image_url"]
    return normalized


def _absolute_url(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    return urljoin(SEARXNG_BASE_URL.rstrip("/") + "/", value)


def _canonicalize_url(url: str) -> str:
    parsed = urlparse(url)
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in TRACKING_QUERY_KEYS and not key.lower().startswith("utm_")
    ]
    netloc = parsed.netloc.lower()
    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/")
    return urlunparse(
        (
            parsed.scheme.lower() or "https",
            netloc,
            path,
            "",
            urlencode(query, doseq=True),
            "",
        )
    )


def _parse_resolution(value) -> tuple[int | None, int | None]:
    if not value:
        return None, None
    match = re.search(r"(\d{2,5})\s*[xX*]\s*(\d{2,5})", str(value))
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def _stringify_date(value) -> str | None:
    if not value:
        return None
    return str(value)


def _score_item(item: dict, *, query: str, title: str, snippet: str, domain: str, rank: int) -> float:
    query_tokens = set(_important_tokens(query, limit=24))
    title_tokens = set(_important_tokens(title, limit=24))
    snippet_tokens = set(_important_tokens(snippet, limit=40))
    domain_tokens = set(re.split(r"[^a-z0-9]+", domain.lower())) - {""}

    overlap = len(query_tokens & (title_tokens | snippet_tokens | domain_tokens))
    title_overlap = len(query_tokens & title_tokens)
    domain_overlap = len(query_tokens & domain_tokens)
    engine_count = len(item.get("engines") or []) if isinstance(item.get("engines"), list) else 1
    raw_score = float(item.get("score") or 0)

    score = math.log1p(max(raw_score, 0)) * 1.5
    score += overlap * 1.2
    score += title_overlap * 1.4
    score += domain_overlap * 0.7
    score += min(engine_count, 4) * 0.35
    score += 1 / max(rank, 1)

    if item.get("publishedDate") or item.get("published_date"):
        score += 0.2
    if title and title.casefold() == domain.casefold():
        score -= 0.6
    return score


def _rank_and_dedupe(results: list[dict], query: str, *, limit: int) -> list[dict]:
    merged: dict[str, dict] = {}
    for result in results:
        key = _dedupe_key(result)
        existing = merged.get(key)
        if not existing or result["_score"] > existing["_score"]:
            merged[key] = result
            continue
        if result.get("snippet") and result["snippet"] not in (existing.get("snippet") or ""):
            existing["snippet"] = " ".join([existing.get("snippet") or "", result["snippet"]]).strip()[:800]

    ranked = sorted(merged.values(), key=lambda item: item["_score"], reverse=True)
    for item in ranked:
        item["score"] = round(float(item.pop("_score", 0)), 3)
        item.pop("_rank", None)
        item.pop("_engines", None)
    return ranked[:limit]


def _dedupe_key(result: dict) -> str:
    if result.get("kind") == "image":
        return (result.get("image_url") or result.get("url") or "").casefold()
    return (result.get("url") or "").casefold()
