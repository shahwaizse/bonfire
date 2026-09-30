import {
  TAVILY_API_KEY, BRAVE_SEARCH_API_KEY, TAVILY_FREE_ONLY_CONFIRMED, BRAVE_FREE_ONLY_CONFIRMED,
  TAVILY_MONTHLY_LIMIT, BRAVE_MONTHLY_LIMIT, SEARCH_USAGE_PATH,
  SEARCH_TIMEOUT_SECONDS, SEARCH_LANGUAGE, SEARCH_SAFESEARCH_DEFAULT,
} from "./config.js";
import { SearchUsage } from "./search-usage.js";

let defaultUsage;
function getDefaultUsage() {
  return defaultUsage ??= new SearchUsage(SEARCH_USAGE_PATH);
}

export function createProviderSearch({
  tavilyKey = TAVILY_API_KEY, braveKey = BRAVE_SEARCH_API_KEY,
  tavilyFreeOnly = TAVILY_FREE_ONLY_CONFIRMED, braveFreeOnly = BRAVE_FREE_ONLY_CONFIRMED,
  tavilyLimit = TAVILY_MONTHLY_LIMIT, braveLimit = BRAVE_MONTHLY_LIMIT,
  usage, fetchFn = (...args) => globalThis.fetch(...args), now = () => new Date(),
} = {}) {
  return async (query, count, { kind = 'web', signal } = {}) => {
    const images = kind === 'images';
    const errors = [];
    for (const provider of [
      { name: "Tavily", key: tavilyKey, freeOnly: tavilyFreeOnly, limit: tavilyLimit },
      { name: "Brave", key: braveKey, freeOnly: braveFreeOnly, limit: braveLimit },
    ]) {
      if (!provider.key || !provider.freeOnly) {
        errors.push(`${provider.name}: add a key and confirm free-only account settings`);
        continue;
      }
      const ledger = usage || getDefaultUsage();
      const date = now();
      // Reserve before sending; failed/uncertain requests are counted conservatively.
      // Storage errors deliberately stop search before any outgoing request.
      if (!ledger.reserve(provider.name, date, provider.limit)) {
        errors.push(`${provider.name}: free request limit reached or temporarily unavailable`);
        continue;
      }
      try {
        let response;
        if (provider.name === "Tavily") {
          const body = {
            query, search_depth: "basic", auto_parameters: false, topic: "general",
            max_results: Math.min(20, count), include_answer: false,
            include_raw_content: false, include_images: images, include_image_descriptions: false, include_usage: true,
            safe_search: SEARCH_SAFESEARCH_DEFAULT > 0,
          };
          if (SEARCH_LANGUAGE && SEARCH_LANGUAGE !== "auto") body.language = SEARCH_LANGUAGE;
          response = await fetchFn("https://api.tavily.com/search", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
            body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_SECONDS * 1000)]) : AbortSignal.timeout(SEARCH_TIMEOUT_SECONDS * 1000),
          });
        } else {
          const url = new URL(images ? 'https://api.search.brave.com/res/v1/images/search' : "https://api.search.brave.com/res/v1/web/search");
          url.searchParams.set("q", query);
          url.searchParams.set("count", String(images ? Math.min(200, count) : Math.min(20, count)));
          url.searchParams.set("safesearch", images ? SEARCH_SAFESEARCH_DEFAULT > 0 ? 'strict' : 'off' : ["off", "moderate", "strict"][Math.max(0, Math.min(2, SEARCH_SAFESEARCH_DEFAULT))] || "off");
          if (SEARCH_LANGUAGE && SEARCH_LANGUAGE !== "auto") url.searchParams.set("search_lang", SEARCH_LANGUAGE);
          response = await fetchFn(url, {
            headers: { Accept: "application/json", "X-Subscription-Token": provider.key },
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_SECONDS * 1000)]) : AbortSignal.timeout(SEARCH_TIMEOUT_SECONDS * 1000),
          });
        }
        if (!response.ok) {
          const exhausted = [402, 432, 433].includes(response.status);
          ledger.block(provider.name, date, exhausted, exhausted ? 0 : response.status === 429 ? 60000 : 300000);
          errors.push(`${provider.name}: ${exhausted ? "free credits exhausted" : `HTTP ${response.status}`}`);
          continue;
        }
        const data = await response.json();
        if (images) {
          let found;
          if (provider.name === 'Tavily') {
            const linked = (data.results || []).flatMap(result => (result.images || []).map(image => ({
              url: typeof image === 'string' ? image : image.url, title: result.title || query,
              description: typeof image === 'object' ? image.description || '' : '', source_url: result.url,
            })));
            const byUrl = new Map(linked.map(image => [image.url, image]));
            const primary = (data.images || []).map(image => {
              const url = typeof image === 'string' ? image : image.url;
              return { ...byUrl.get(url), url, title: byUrl.get(url)?.title || query,
                description: typeof image === 'object' ? image.description || byUrl.get(url)?.description || '' : byUrl.get(url)?.description || '',
                source_url: byUrl.get(url)?.source_url || (typeof image === 'object' ? image.source_url || '' : '') };
            });
            found = primary.length ? primary : linked;
          } else {
            if (!Array.isArray(data.results)) throw new Error('Invalid image search response');
            found = data.results.map(image => ({ title: image.title || query, url: image.properties?.url || image.thumbnail?.src,
              thumbnail: image.thumbnail?.src, source_url: image.url, width: image.properties?.width, height: image.properties?.height }));
          }
          const valid = found.filter(image => /^https?:\/\//i.test(image.url || ''));
          if (valid.length) return valid.map(image => ({ ...image, source: provider.name }));
          errors.push(`${provider.name}: no image results`);
          continue;
        }
        const results = provider.name === "Tavily" ? data.results : data.web?.results;
        if (!Array.isArray(results)) throw new Error("Invalid search response");
        return results.map((item) => ({ ...item, content: item.content || item.description || "", source: provider.name }));
      } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error;
        ledger.block(provider.name, date, false, 30000);
        errors.push(`${provider.name}: request failed`);
      }
    }
    throw new Error(`Free web search unavailable. ${errors.join("; ")}. Chat and direct URL reading still work.`);
  };
}

export const providerSearch = createProviderSearch();
