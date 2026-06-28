import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, queryVariants, search } from "../src/search.js";

test("queryVariants strips assistant phrasing and adds a compact variant", () => {
  const variants = queryVariants("please look up the latest llama.cpp Vulkan performance news", 3);
  assert.equal(variants[0], "latest llama.cpp Vulkan performance news");
  assert.ok(variants.some((variant) => variant.includes("llama.cpp vulkan performance")));
});

test("canonicalizeUrl drops tracking parameters and fragments", () => {
  const url = canonicalizeUrl("https://Example.com/story/?utm_source=x&keep=1&fbclid=abc#section");
  assert.equal(url, "https://example.com/story?keep=1");
});

test("search tries Google Images safe-search-off and falls back to working image engines", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (rawUrl) => {
    const url = new URL(String(rawUrl));
    calls.push(url);
    const category = url.searchParams.get("categories");
    const q = url.searchParams.get("q") || "";
    let body;

    if (category === "images" && q.startsWith("!goi ")) {
      body = { results: [], unresponsive_engines: [["google images", "Suspended: access denied"]] };
    } else if (category === "images") {
      body = {
        results: [
          {
            title: "Bonfire photo",
            url: "https://images.example.com/page",
            img_src: "https://cdn.example.com/bonfire.jpg",
            thumbnail_src: "https://cdn.example.com/bonfire-thumb.jpg",
            engine: "duckduckgo images",
          },
        ],
      };
    } else {
      body = {
        results: [
          {
            title: "Bonfire article",
            url: "https://example.com/bonfire?utm_source=test",
            content: "A useful web source.",
            engine: "google",
          },
        ],
      };
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const results = await search("show me bonfire images", 3, {
      variantCount: 1,
      imageResults: 1,
      imageEngines: "google images",
    });

    assert.equal(calls.some((url) => url.searchParams.get("categories") === "general"), true);
    assert.equal(calls.some((url) => url.searchParams.get("categories") === "images"), true);
    assert.equal(calls.every((url) => url.searchParams.get("safesearch") === "0"), true);
    assert.equal(calls.some((url) => url.searchParams.get("q")?.startsWith("!goi ")), true);
    assert.equal(calls.some((url) => url.searchParams.get("q")?.startsWith("!ddi ")), true);
    assert.equal(results.some((result) => result.kind === "web"), true);
    assert.equal(results.some((result) => result.kind === "image" && result.thumbnail_url), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
