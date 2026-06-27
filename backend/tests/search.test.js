import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, queryVariants } from "../src/search.js";

test("queryVariants strips assistant phrasing and adds a compact variant", () => {
  const variants = queryVariants("please look up the latest llama.cpp Vulkan performance news", 3);
  assert.equal(variants[0], "latest llama.cpp Vulkan performance news");
  assert.ok(variants.some((variant) => variant.includes("llama.cpp vulkan performance")));
});

test("canonicalizeUrl drops tracking parameters and fragments", () => {
  const url = canonicalizeUrl("https://Example.com/story/?utm_source=x&keep=1&fbclid=abc#section");
  assert.equal(url, "https://example.com/story?keep=1");
});
