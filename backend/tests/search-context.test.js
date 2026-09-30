import test from "node:test";
import assert from "node:assert/strict";
import { resolveSearchContext } from "../src/search-context.js";

test("resolveSearchContext reads direct links even when web search is off", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      "<!doctype html><html><head><title>Direct Story</title></head><body><main><p>Direct page evidence survives extraction.</p></main></body></html>",
      { status: 200, headers: { "content-type": "text/html" } }
    );

  const events = [];
  try {
    const context = await resolveSearchContext({
      message: "summarize https://example.com/story",
      webEnabled: false,
      emit: (type, data) => events.push({ type, data }),
    });

    assert.equal(context.sources.length, 1);
    assert.match(context.webContext, /Direct page evidence/);
    assert.equal(events.some((event) => event.type === "page_read"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveSearchContext searches and reads top web result when enabled", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (rawUrl) => {
    const url = String(rawUrl);
    calls.push(url);

    return new Response(
      "<!doctype html><html><head><title>Result Page</title></head><body><article><p>Readable result page content.</p></article></body></html>",
      { status: 200, headers: { "content-type": "text/html" } }
    );
  };

  try {
    const context = await resolveSearchContext({
      message: "latest Bonfire release notes",
      webEnabled: true,
      searchFn: async () => [{ title: "Search Result", url: "https://example.com/result", snippet: "Search snippet.", source: "Tavily" }],
    });

    assert.equal(calls.includes("https://example.com/result"), true);
    assert.equal(context.sources[0].url, "https://example.com/result");
    assert.match(context.webContext, /Readable result page content/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exhausted free search tells the model it could not search", async () => {
  const events = [];
  const context = await resolveSearchContext({
    message: "latest news", webEnabled: true,
    searchFn: async () => { throw new Error("Free credits exhausted"); },
    emit: (type, data) => events.push({ type, data }),
  });
  assert.match(context.webContext, /Web search was unavailable/);
  assert.match(context.webContext, /do not claim to have searched/);
  assert.equal(events.some((event) => event.type === "status" && event.data.includes("Free credits exhausted")), true);
});
