import { providerSearch } from './search-providers.js';

// Only suppresses the manual Web prefetch for picture requests. It never invokes image search.
export function isPictureRequest(message, history = []) {
  const text = String(message || '').trim();
  if (/\b(?:code|function|component|script|html|css|react|python)\b/i.test(text) && /\b(?:write|implement|build|how to|code for)\b/i.test(text)) return false;
  if (/\b(?:show|find|search|fetch|get|bring|display|pull|look|see|want|need)\b.{0,100}\b(?:images?|pictures?|photos?|pics|photographs?|wallpapers?)\b/i.test(text)) return true;
  if (/^(?:images?|pictures?|photos?|pics|wallpapers?)\s+(?:of|for|from)\b/i.test(text)) return true;
  if (/^(?:more|another|other|some more)(?:\s+(?:images?|pictures?|photos?|pics))?[.!?]*$/i.test(text)) {
    const previous = [...history].reverse().find(item => item.role === 'user' && item.content !== text);
    return previous ? isPictureRequest(previous.content) : false;
  }
  return false;
}

export function publicImageUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) return '';
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':')) return '';
    return url.toString();
  } catch { return ''; }
}

export async function searchImages(query, { count = 8, searchProvider = providerSearch, signal } = {}) {
  const clean = String(query || '').trim().slice(0, 300);
  if (!clean) return [];
  const results = await searchProvider(clean, Math.max(1, Math.min(12, count)), { kind: 'images', signal });
  const images = new Map();
  for (const item of results) {
    const url = publicImageUrl(item.url);
    if (!url || images.has(url)) continue;
    if (!/\b(?:logo|icon|wordmark|branding)\b/i.test(clean) && /(?:favicon|wordmark|tagline|\/static\/images\/|\/logos?\/|\.svg(?:\?|$))/i.test(url)) continue;
    images.set(url, { url, thumbnail: publicImageUrl(item.thumbnail) || url,
      source_url: publicImageUrl(item.source_url) || url, title: String(item.title || clean).slice(0, 240),
      description: String(item.description || '').slice(0, 400), source: item.source || null });
  }
  return [...images.values()].slice(0, count);
}
