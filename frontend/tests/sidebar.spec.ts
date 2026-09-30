import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 700, "desktop sidebar behavior");
});

test("renames and deletes a conversation from the lean sidebar", async ({ page }) => {
  const suffix = Date.now();
  const title = `Research thread ${suffix}`;

  await page.goto("/");

  const input = page.getByPlaceholder("Ask anything...");
  await input.fill(`Reply with exactly: sidebar chat works ${suffix}`);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(`sidebar chat works ${suffix}`).first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /Reply with exactly: sidebar chat works|sidebar chat works/i }).first().hover();
  const firstAction = page.locator('button[aria-label^="Actions for"]').first();
  await expect(firstAction).toBeVisible();
  await firstAction.click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Conversation title").fill(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();

  await page.locator(`button[aria-label="Actions for ${title}"]`).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
});
