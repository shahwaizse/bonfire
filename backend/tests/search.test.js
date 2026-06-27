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

test("search requests safe-search-off web and image results", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (rawUrl) => {
    const url = new URL(String(rawUrl));
    calls.push(url);
    const category = url.searchParams.get("categories");
    const results =
      category === "images"
        ? [
            {
              title: "Bonfire photo",
              url: "https://images.example.com/page",
              img_src: "https://cdn.example.com/bonfire.jpg",
              thumbnail: "https://cdn.example.com/bonfire-thumb.jpg",
              engine: "google images",
            },
          ]
        : [
            {
              title: "Bonfire article",
              url: "https://example.com/bonfire?utm_source=test",
              content: "A useful web source.",
              engine: "google",
            },
          ];

    return new Response(JSON.stringify({ results }), {
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
    assert.equal(calls.find((url) => url.searchParams.get("categories") === "images").searchParams.get("engines"), "google images");
    assert.equal(results.some((result) => result.kind === "web"), true);
    assert.equal(results.some((result) => result.kind === "image" && result.thumbnail_url), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
