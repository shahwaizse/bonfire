import { expect, test } from "@playwright/test";

const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";

test.beforeEach(async ({ request }) => {
  await request.put(`${BACKEND_URL}/settings`, {
    data: { prompt_mode: "auto", guardrails: "", search_default: false },
  });
});

test("loads to the empty state with a focused composer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Ask anything...")).toBeVisible();
  await expect(page.getByText("Sic parvis magna")).toBeVisible();
});

test("llama.cpp status indicator goes green", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[aria-label="llama.cpp online"]:visible')).toBeVisible({ timeout: 15_000 });
});

test("sends a message and streams a real response", async ({ page }) => {
  await page.goto("/");
  const input = page.getByPlaceholder("Ask anything...");
  await input.fill("Reply with exactly: bonfire chat works");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.locator('[data-message-role="assistant"]').getByText("bonfire chat works")).toBeVisible({
    timeout: 30_000,
  });
  // Send is disabled again once the stream completes (button re-enables only with text in the box).
  await expect(page.getByPlaceholder("Ask anything...")).toHaveValue("");
});

test("does not force-scroll to the bottom when a long answer arrives", async ({ page }) => {
  const longAnswer = Array.from({ length: 140 }, (_, index) => `stream line ${index + 1}`).join("\n\n");
  await page.route(`${BACKEND_URL}/chat`, async (route) => {
    const events = [
      { type: "conversation", data: { conversation_id: "playwright-scroll-chat", title: "Scroll test" } },
      { type: "preset", data: { id: "general", name: "General" } },
      { type: "status", data: "Generating answer..." },
      { type: "token", data: longAnswer },
      { type: "done", data: { conversation_id: "playwright-scroll-chat" } },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("Ask anything...").fill("Write a long answer");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("stream line 1", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();

  const transcript = page.getByTestId("message-viewport");
  const isPinnedAboveBottom = await transcript.evaluate((el) => el.scrollTop + el.clientHeight < el.scrollHeight - 80);
  expect(isPinnedAboveBottom).toBe(true);
});

test("starting a new chat clears the conversation and returns to empty state", async ({ page }) => {
  await page.goto("/");
  const input = page.getByPlaceholder("Ask anything...");
  await input.fill("Reply with exactly: first conversation");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("main", { name: "Messages" }).getByText("Reply with exactly: first conversation")
  ).toBeVisible({ timeout: 30_000 });

  const isMobile = (page.viewportSize()?.width ?? 1440) < 700;
  if (isMobile) {
    await page.getByRole("button", { name: "Open conversations" }).click();
  }
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByPlaceholder("Ask anything...")).toBeVisible();
  await expect(page.getByRole("main").getByText("first conversation")).toHaveCount(0);
});
