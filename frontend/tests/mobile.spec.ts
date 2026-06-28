import { expect, test } from "@playwright/test";

const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 1440) >= 700, "mobile-only layout behavior");
  void testInfo;
});

test("sidebar is hidden behind a hamburger and opens as a drawer", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "New chat" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open conversations" }).click();
  const newChatButton = page.getByRole("button", { name: "New chat" });
  await expect(newChatButton).toBeInViewport();

  await page.getByRole("button", { name: "Close sidebar" }).click();
  await expect(page.getByRole("button", { name: "New chat" })).toHaveCount(0);
});

test("settings opens from the sidebar on mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open conversations" }).click();
  await page.getByRole("button", { name: "Settings" }).click();

  const panel = page.getByTestId("settings-panel");
  const box = await panel.boundingBox();
  const viewportWidth = page.viewportSize()!.width;
  expect(box?.width).toBeGreaterThan(viewportWidth * 0.9);
});

test("composer and sidebar fit without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body > header")).toHaveCount(0);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

test("composer stays inside the mobile viewport after sending", async ({ page }) => {
  await page.route(`${BACKEND_URL}/chat`, async (route) => {
    const events = [
      { type: "conversation", data: { conversation_id: "mobile-composer-chat", title: "Mobile composer" } },
      { type: "preset", data: { id: "general", name: "General" } },
      { type: "status", data: "Generating answer..." },
      { type: "token", data: "mobile response ok" },
      { type: "done", data: { conversation_id: "mobile-composer-chat" } },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("Ask anything...").fill("hi");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("mobile response ok")).toBeVisible();

  const composer = page.locator("footer form:has([data-composer-input])");
  await expect(composer).toBeVisible();
  const box = await composer.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});
