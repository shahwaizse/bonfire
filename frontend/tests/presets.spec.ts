import { expect, test } from "@playwright/test";

const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";

// Auto-routing only happens in "auto" mode; reset it so an earlier
// settings.spec.ts run (or test order) can't leave this pinned/custom.
test.beforeEach(async ({ request }) => {
  await request.put(`${BACKEND_URL}/settings`, {
    data: { prompt_mode: "auto", guardrails: "", search_default: false },
  });
});

test("auto-routes a coding question to the Coding preset", async ({ page }) => {
  await page.goto("/");
  const input = page.getByPlaceholder("Ask anything...");
  await input.fill("I have a python bug: my function throws a stack trace on a regex error.");
  await page.getByRole("button", { name: "Send message" }).click();

  // The "Routing to X..." status is intentionally transient (replaced by
  // "Generating answer..." within the same render pass) -- the durable
  // signal is the preset badge stamped on the assistant's message.
  await expect(page.locator("main").getByText("Coding", { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("auto-routes an explicit creative request to the NSFW preset", async ({ page }) => {
  await page.goto("/");
  const input = page.getByPlaceholder("Ask anything...");
  await input.fill("Write an explicit erotic scene between two consenting adults.");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.locator("main").getByText("NSFW", { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("manually pinning a preset overrides auto-routing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Auto", exact: true }).click();
  await page.getByRole("option", { name: /Coding/ }).click();

  const input = page.getByPlaceholder("Ask anything...");
  await input.fill("What's a good way to spend a rainy Sunday?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.locator("main").getByText("Coding", { exact: true })).toBeVisible({ timeout: 30_000 });
});
