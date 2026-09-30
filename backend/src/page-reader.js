import * as cheerio from "cheerio";
import { PAGE_EXCERPT_CHARS, SEARCH_TIMEOUT_SECONDS } from "./config.js";

const READER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const BOILERPLATE_RE =
  /(^|[\s_-])(ad|ads|advert|banner|breadcrumb|cookie|consent|footer|header|menu|modal|nav|newsletter|promo|related|share|sidebar|social|subscribe)([\s_-]|$)/i;
const PROTECTED_TAGS = new Set(["html", "body", "main", "article"]);
const CONTENT_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  "[itemprop='articleBody']",
  ".article",
  ".article-body",
  ".entry-content",
  ".post-content",
  ".story-body",
  ".content",
  "#content",
];
const TEXT_SELECTORS = "h1,h2,h3,p,li,blockquote,pre";

export async function readPage(url, { signal } = {}) {
  const requestedUrl = normalizeReadUrl(url);
  const response = await fetch(requestedUrl, {
    headers: {
      "User-Agent": READER_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,text/plain,application/json,application/xml,text/xml;q=0.8,*/*;q=0.2",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_SECONDS * 1000)]) : AbortSignal.timeout(SEARCH_TIMEOUT_SECONDS * 1000),
  });
  if (!response.ok) throw new Error(`Page returned ${response.status}`);

  const contentType = response.headers.get("content-type") || "";
  const finalUrl = response.url || requestedUrl;
  if (isUnsupportedBinary(contentType)) {
    return {
      title: finalUrl,
      url: finalUrl,
      requested_url: requestedUrl,
      excerpt: `The URL returned ${contentType}; Bonfire can only extract text from HTML or text-like responses.`,
    };
  }

  const raw = await response.text();
  if (!isHtmlResponse(contentType, raw)) {
    return {
      title: finalUrl,
      url: finalUrl,
      requested_url: requestedUrl,
      excerpt: normalize(raw).slice(0, PAGE_EXCERPT_CHARS),
    };
  }

  const $ = cheerio.load(raw);
  $("script,style,noscript,svg,canvas,iframe,form,nav,footer,header,aside,button,input,select,textarea").remove();
  $("[hidden],[aria-hidden='true']").remove();
  $("[class],[id]").each((_, element) => {
    const tagName = String(element.tagName || element.name || "").toLowerCase();
    if (PROTECTED_TAGS.has(tagName)) return;
    const signature = `${$(element).attr("class") || ""} ${$(element).attr("id") || ""}`;
    if (BOILERPLATE_RE.test(signature)) $(element).remove();
  });

  const title = normalize(
    $("meta[property='og:title']").attr("content") ||
      $("meta[name='twitter:title']").attr("content") ||
      $("title").first().text() ||
      $("h1").first().text() ||
      url
  );
  const description = normalize(
    $("meta[name='description']").attr("content") || $("meta[property='og:description']").attr("content") || ""
  );
  const excerpt = normalize([description, bestContent($)].filter(Boolean).join(" ")).slice(0, PAGE_EXCERPT_CHARS);
  return { title, url: finalUrl, requested_url: requestedUrl, excerpt };
}

function normalizeReadUrl(value) {
  let text = String(value || "").trim();
  if (/^www\./i.test(text)) text = `https://${text}`;
  const parsed = new URL(text);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https page URLs are supported");
  }
  return parsed.toString();
}

function isHtmlResponse(contentType, raw) {
  const type = contentType.toLowerCase();
  if (type.includes("html") || type.includes("xhtml")) return true;
  return /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(raw);
}

function isUnsupportedBinary(contentType) {
  const type = contentType.toLowerCase();
  if (!type) return false;
  if (type.startsWith("text/")) return false;
  if (type.includes("html") || type.includes("json") || type.includes("xml")) return false;
  return true;
}

function bestContent($) {
  const candidates = CONTENT_SELECTORS.map((selector) => {
    const element = $(selector).first();
    if (!element.length) return null;
    const text = extractText($, element);
    return { text, score: scoreText(text) };
  }).filter(Boolean);

  candidates.push({ text: extractText($, $("body").first()), score: scoreText(extractText($, $("body").first())) });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.text || "";
}

function extractText($, root) {
  const chunks = [];
  root.find(TEXT_SELECTORS).each((_, element) => {
    const text = normalize($(element).text());
    if (text.length >= 20 || /^h[1-3]$/i.test(element.tagName)) chunks.push(text);
  });
  return chunks.join(" ");
}

function scoreText(text) {
  const normalized = normalize(text);
  if (!normalized) return 0;
  const words = normalized.split(/\s+/).length;
  const punctuation = (normalized.match(/[.!?]/g) || []).length;
  return normalized.length + words * 8 + punctuation * 80;
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
