import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 1440) >= 700, "mobile-only layout behavior");
  void testInfo;
});

test("sidebar is hidden behind a hamburger and opens as a drawer", async ({ page }) => {
  await page.goto("/");

  // Off-canvas: the New chat button exists in the DOM but is not in view.
  const newChatButton = page.getByRole("button", { name: "New chat" });
  await expect(newChatButton).toBeAttached();
  const hiddenBox = await newChatButton.boundingBox();
  expect(hiddenBox?.x).toBeLessThan(0);

  await page.getByRole("button", { name: "Open conversations" }).click();
  // The drawer slides in over a 200ms CSS transition -- wait for it to
  // actually land in the viewport rather than reading boundingBox mid-animation.
  await expect(newChatButton).toBeInViewport();

  // Tapping the backdrop closes it again.
  await page.mouse.click(page.viewportSize()!.width - 5, 200);
  await expect(newChatButton).not.toBeInViewport();
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
