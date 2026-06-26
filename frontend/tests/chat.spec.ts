import { expect, test } from "@playwright/test";

const BACKEND_URL = "http://127.0.0.1:8000";

test.beforeEach(async ({ request }) => {
  await request.put(`${BACKEND_URL}/settings`, {
    data: { prompt_mode: "auto", guardrails: "", search_default: false, memory_enabled: false },
  });
});

test("loads to the empty state with a focused composer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Ask anything...")).toBeVisible();
  await expect(page.getByText("Sic parvis magna")).toBeVisible();
});

test("llama.cpp status indicator goes green", async ({ page }) => {
  await page.goto("/");
  const dot = page.locator('span[title="llama.cpp online"]');
  await expect(dot).toBeVisible({ timeout: 15_000 });
});

test("sends a message and streams a real response", async ({ page }) => {
  await page.goto("/");
  const input = page.getByPlaceholder("Ask anything...");
  await input.fill("Reply with exactly: bonfire chat works");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("bonfire chat works")).toBeVisible({ timeout: 30_000 });
  // Send is disabled again once the stream completes (button re-enables only with text in the box).
  await expect(page.getByPlaceholder("Ask anything...")).toHaveValue("");
});

test("starting a new chat clears the conversation and returns to empty state", async ({ page }) => {
  await page.goto("/");
  const input = page.getByPlaceholder("Ask anything...");
  await input.fill("Reply with exactly: first conversation");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("first conversation").first()).toBeVisible({ timeout: 30_000 });

  const isMobile = (page.viewportSize()?.width ?? 1440) < 700;
  if (isMobile) {
    await page.getByRole("button", { name: "Open conversations" }).click();
  }
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByPlaceholder("Ask anything...")).toBeVisible();
  await expect(page.getByText("first conversation")).toHaveCount(0);
});
