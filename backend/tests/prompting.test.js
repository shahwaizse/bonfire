import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, buildWebContext, selectRecentHistory, buildChatMessages } from "../src/prompting.js";

test("buildSystemPrompt returns the compact core prompt and runtime context", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /You are Bonfire, a general-purpose local AI assistant/);
  assert.match(prompt, /Runtime context:/);
  assert.doesNotMatch(prompt, /preset/i);
});

test('web evidence and history produce exactly one initial system message', () => {
  const messages = buildChatMessages({ history: [{ role: 'system', content: 'old system' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'find photos' }], webContext: 'Sources:\n[1] Photo gallery', webEnabled: true });
  assert.equal(messages.filter(message => message.role === 'system').length, 1);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Photo gallery/);
  assert.match(messages[0].content, /Web search toggle is ON/);
  assert.equal(messages.at(-1).content, 'find photos');
  assert.doesNotMatch(messages[0].content, /old system/);
});

test('general generation and host web capabilities are distinct from MCP access', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /draft code/);
  assert.match(prompt, /do not require tools or file-write permissions/);
  assert.match(prompt, /Web search toggle is OFF/);
  assert.match(prompt, /displays the pictures below/);
});

test("selectRecentHistory keeps the newest coherent suffix", () => {
  const history = [
    { role: "user", content: "old".repeat(100) },
    { role: "assistant", content: "middle" },
    { role: "user", content: "new" },
  ];
  assert.deepEqual(selectRecentHistory(history, 80), [
    { role: "assistant", content: "middle" },
    { role: "user", content: "new" },
  ]);
});

test("buildWebContext matches page reads by requested URL when a page redirects", () => {
  const context = buildWebContext(
    [
      {
        title: "Original result",
        url: "https://example.com/original?utm_source=x",
        snippet: "Search snippet.",
        kind: "web",
        domain: "example.com",
      },
    ],
    [
      {
        title: "Final page",
        url: "https://example.com/final",
        requested_url: "https://example.com/original?utm_source=x",
        excerpt: "Redirected page content that the model should receive.",
      },
    ]
  );

  assert.match(context, /Redirected page content/);
});
