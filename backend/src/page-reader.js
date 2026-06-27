import * as cheerio from "cheerio";
import { PAGE_EXCERPT_CHARS, SEARCH_TIMEOUT_SECONDS } from "./config.js";

export async function readPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Bonfire/0.2 local page reader",
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2",
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_SECONDS * 1000),
  });
  if (!response.ok) throw new Error(`Page returned ${response.status}`);

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!contentType.includes("html")) {
    return { title: url, url: response.url || url, excerpt: normalize(raw).slice(0, PAGE_EXCERPT_CHARS) };
  }

  const $ = cheerio.load(raw);
  $("script,style,noscript,svg,canvas,iframe,form,nav,footer").remove();
  const title = normalize($("title").first().text() || $("h1").first().text() || url);
  const excerpt = normalize($("main").text() || $("article").text() || $("body").text()).slice(0, PAGE_EXCERPT_CHARS);
  return { title, url: response.url || url, excerpt };
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
