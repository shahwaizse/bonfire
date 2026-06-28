import type { SearchResultItem } from "./types";

export function sourceDomain(source: Pick<SearchResultItem, "domain" | "url">) {
  if (source.domain) return source.domain.replace(/^www\./, "");
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function faviconUrl(source: Pick<SearchResultItem, "domain" | "url">, size = 32) {
  const domain = sourceDomain(source);
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}
