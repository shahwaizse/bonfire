import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProviderSearch } from "../src/search-providers.js";
import { SearchUsage } from "../src/search-usage.js";

const date = new Date("2026-09-15T12:00:00Z");
const json = (data) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
function setup(t, options = {}) {
  const usage = new SearchUsage(":memory:");
  t.after(() => usage.close());
  return createProviderSearch({
    tavilyKey: "test-tavily", braveKey: "test-brave", tavilyFreeOnly: true, braveFreeOnly: true,
    tavilyLimit: 1000, braveLimit: 1000, usage, now: () => date, ...options,
  });
}

test("Tavily basic search avoids automatic credit upgrades and does not call Brave on success", async (t) => {
  const calls = [];
  const search = setup(t, { fetchFn: async (url, options) => {
    calls.push(String(url));
    const body = JSON.parse(options.body);
    assert.equal(body.search_depth, "basic");
    assert.equal(body.auto_parameters, false);
    assert.equal(body.include_answer, false);
    assert.equal(body.include_raw_content, false);
    assert.equal(options.headers.Authorization, "Bearer test-tavily");
    return json({ results: [{ title: "Article", url: "https://example.com", content: "Evidence" }] });
  } });
  const results = await search("test", 5);
  assert.deepEqual(calls, ["https://api.tavily.com/search"]);
  assert.equal(results[0].source, "Tavily");
});

test("Tavily credit exhaustion falls back to Brave and stays blocked until next month", async (t) => {
  const calls = [];
  const search = setup(t, { fetchFn: async (url, options) => {
    calls.push(String(url));
    if (String(url).includes("tavily")) return new Response("credits exhausted", { status: 432 });
    assert.equal(options.headers["X-Subscription-Token"], "test-brave");
    return json({ web: { results: [{ url: "https://example.org", description: "Brave evidence" }] } });
  } });
  assert.equal((await search("test", 5))[0].content, "Brave evidence");
  await search("another", 5);
  assert.equal(calls.filter((url) => url.includes("tavily")).length, 1);
  assert.equal(calls.filter((url) => url.includes("brave")).length, 2);
});

test("local caps stop both providers before further requests", async (t) => {
  const calls = [];
  const search = setup(t, { tavilyLimit: 1, braveLimit: 1, fetchFn: async (url) => {
    calls.push(String(url));
    return String(url).includes("tavily") ? json({ results: [] }) : json({ web: { results: [] } });
  } });
  await search("one", 5);
  await search("two", 5);
  await assert.rejects(search("three", 5), /Free web search unavailable/);
  assert.equal(calls.length, 2);
});

test("missing keys or unconfirmed free-only settings never send requests", async (t) => {
  const search = setup(t, { tavilyFreeOnly: false, braveKey: "", fetchFn: async () => {
    assert.fail("Provider called without safe configuration");
  } });
  await assert.rejects(search("test", 5), /confirm free-only account settings/);
});

test("Brave works without a Tavily key, and exhausted Brave credits stop further requests", async (t) => {
  let calls = 0;
  const search = setup(t, { tavilyKey: "", fetchFn: async (url) => {
    calls++;
    assert.match(String(url), /api.search.brave.com/);
    return new Response("No free credits", { status: 402 });
  } });
  await assert.rejects(search("test", 5), /Brave: free credits exhausted/);
  await assert.rejects(search("retry", 5), /Free web search unavailable/);
  assert.equal(calls, 1);
});

test("timeout and rate limit failures fall back without repeatedly spending Tavily credits", async (t) => {
  for (const status of [429, "network"]) {
    let attempts = 0;
    const search = setup(t, { fetchFn: async (url) => {
      if (String(url).includes("tavily")) {
        attempts++;
        if (status === "network") throw new Error("test-tavily secret must not appear");
        return new Response("rate limited", { status });
      }
      return json({ web: { results: [] } });
    } });
    await search("test", 5);
    await search("retry", 5);
    assert.equal(attempts, 1);
  }
});

test("quota reservations are atomic across connections, survive reopen, and reset by month", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bonfire-search-"));
  const filename = path.join(dir, "usage.db");
  let a, b;
  try {
    a = new SearchUsage(filename);
    b = new SearchUsage(filename);
    assert.equal(a.reserve("Tavily", date, 2), true);
    assert.equal(b.reserve("Tavily", date, 2), true);
    assert.equal(a.reserve("Tavily", date, 2), false);
    a.close(); a = new SearchUsage(filename);
    assert.equal(a.reserve("Tavily", date, 2), false);
    assert.equal(a.reserve("Tavily", new Date("2026-10-01T00:00:00Z"), 2), true);
    assert.equal(a.reserve("Brave", date, 0), false);
    assert.equal(a.reserve("Hard cap", date, 100000), true);
    a.db.prepare("UPDATE search_usage SET used = 1000 WHERE provider = 'Hard cap'").run();
    assert.equal(a.reserve("Hard cap", date, 100000), false);
  } finally {
    a?.close(); b?.close();
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
    fs.rmdirSync(dir);
  }
});

test("ledger failure prevents outgoing requests", async (t) => {
  const search = setup(t, { usage: { reserve() { throw new Error("Disk unavailable"); } },
    fetchFn: async () => assert.fail("Search must fail closed") });
  await assert.rejects(search("test", 5), /Disk unavailable/);
});
