import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, extractHttpUrls, search, stripUrls } from "../src/search.js";

test("canonicalizeUrl drops tracking parameters and fragments", () => {
  const url = canonicalizeUrl("https://Example.com/story/?utm_source=x&keep=1&fbclid=abc#section");
  assert.equal(url, "https://example.com/story?keep=1");
});

test("extractHttpUrls handles direct links with wrappers and trailing punctuation", () => {
  const urls = extractHttpUrls(
    'Read [this](https://Example.com/story/?utm_source=x&keep=1#frag), then https://en.wikipedia.org/wiki/Test_(assessment). Also www.example.org/path.'
  );

  assert.deepEqual(urls, [
    "https://example.com/story?keep=1",
    "https://en.wikipedia.org/wiki/Test_(assessment)",
    "https://www.example.org/path",
  ]);
});

test("stripUrls removes direct links before query generation", () => {
  assert.equal(stripUrls("summarize https://example.com/story?utm_source=x please"), "summarize please");
  assert.equal(stripUrls("Read [the article](https://example.com/story), then explain it."), "Read the article then explain it.");
});

test("search normalizes the query and hosted provider results", async () => {
  const calls = [];
  const searchProvider = async (query, count) => {
    calls.push({ query, count });
    return [
      {
        title: "Bonfire article",
        url: "https://Example.com/bonfire?utm_source=test#top",
        content: "A useful web source.",
        source: "Tavily",
      },
    ];
  };
  const results = await search("please look up the latest bonfire news", 3, searchProvider);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, "latest bonfire news");
  assert.equal(calls[0].count, 3);
  assert.equal(results[0].url, "https://example.com/bonfire");
  assert.equal(results[0].kind, "web");
  assert.equal(results[0].source, "Tavily");
});
