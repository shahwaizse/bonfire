import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, selectRecentHistory } from "../src/prompting.js";

test("buildSystemPrompt layers mode and guardrails", () => {
  const prompt = buildSystemPrompt("Be terse.", "No secrets.", "");
  assert.match(prompt, /Active behavior layer:\nBe terse\./);
  assert.match(prompt, /Configured guardrails:\nNo secrets\./);
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
