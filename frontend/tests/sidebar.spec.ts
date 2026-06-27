import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) < 700, "desktop sidebar behavior");
});

test("renames, folders, and searches a conversation", async ({ page }) => {
  const suffix = Date.now();
  const title = `Research thread ${suffix}`;
  const folder = `Research ${suffix}`;

  await page.goto("/");

  const input = page.getByPlaceholder("Ask anything...");
  await input.fill(`Reply with exactly: sidebar chat works ${suffix}`);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(`sidebar chat works ${suffix}`).first()).toBeVisible({ timeout: 30_000 });

  await expect(page.locator('button[aria-label^="Actions for"]').first()).toBeVisible();
  await page.locator('button[aria-label^="Actions for"]').first().click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Conversation title").fill(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();

  await page.locator(`button[aria-label="Actions for ${title}"]`).click();
  await page.getByRole("menuitem", { name: "Move to folder" }).click();
  await page.getByLabel("Folder name").fill(folder);
  await page.getByRole("button", { name: "Move" }).click();

  await expect(page.getByRole("heading", { name: folder })).toBeVisible();
  await page.getByLabel("Search chats").fill(title);
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  await page.getByLabel("Search chats").fill("missing conversation");
  await expect(page.getByText("No chats match your search.")).toBeVisible();
});
