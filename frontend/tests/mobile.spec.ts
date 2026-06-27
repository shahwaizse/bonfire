import { expect, test } from "@playwright/test";

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
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});
