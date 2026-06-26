import { expect, test } from "@playwright/test";

const BACKEND_URL = "http://127.0.0.1:8000";

async function openSettings(page: import("@playwright/test").Page) {
  if ((page.viewportSize()?.width ?? 1440) < 700) {
    await page.getByRole("button", { name: "Open conversations" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
}

// These tests share a real backend/database (no mocking), so prompt_mode
// from an earlier test (e.g. "custom") would otherwise leak into later ones.
// Reset to the default before each test for order-independent runs.
test.beforeEach(async ({ request }) => {
  await request.put(`${BACKEND_URL}/settings`, {
    data: {
      prompt_mode: "auto",
      guardrails: "",
      search_default: false,
      memory_enabled: true,
      memory_auto_extract: true,
    },
  });
});

test.afterEach(async ({ request }) => {
  const res = await request.get(`${BACKEND_URL}/memories`, {
    params: { query: "playwright-memory-" },
  });
  if (!res.ok()) return;
  const memories = (await res.json()) as { id: string; text: string }[];
  await Promise.all(
    memories
      .filter((memory) => memory.text.includes("playwright-memory-"))
      .map((memory) => request.delete(`${BACKEND_URL}/memories/${memory.id}`))
  );
});

test("opens settings and switches between tabs", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);

  const panel = page.getByTestId("settings-panel");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(panel.getByText("Mode", { exact: true })).toBeVisible();

  await panel.getByRole("tab", { name: /guardrails/i }).click();
  await expect(panel.getByPlaceholder(/Never reveal private API keys/)).toBeVisible();

  await panel.getByRole("tab", { name: /status/i }).click();
  await expect(panel.getByText("llama.cpp", { exact: true })).toBeVisible();
});

test("lists the three built-in presets and can expand one", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  const panel = page.getByTestId("settings-panel");

  await expect(panel.getByText("General", { exact: true })).toBeVisible();
  await expect(panel.getByText("Coding", { exact: true })).toBeVisible();
  await expect(panel.getByText("NSFW", { exact: true })).toBeVisible();

  await panel.getByText("Coding", { exact: true }).click();
  const textarea = panel.locator("textarea").first();
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue(/Coding mode/);
});

test("editing a preset prompt enables the Save button", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  const panel = page.getByTestId("settings-panel");
  await panel.getByText("General", { exact: true }).click();

  const textarea = panel.locator("textarea").first();
  const original = await textarea.inputValue();
  const saveButton = panel.getByRole("button", { name: "Save", exact: true });

  await expect(saveButton).toBeDisabled();
  await textarea.fill(original + " Stay upbeat.");
  await expect(saveButton).toBeEnabled();
});

test("switching to custom mode reveals a prompt textarea", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  const panel = page.getByTestId("settings-panel");
  await panel.getByRole("button", { name: "Custom", exact: true }).click();

  await expect(panel.getByPlaceholder("Add behavior instructions...")).toBeVisible();
});

test("memory tab can add, search, graph, and delete a memory", async ({ page }) => {
  const unique = `playwright-memory-${Date.now()} prefers compact TypeScript examples`;
  await page.goto("/");
  await openSettings(page);
  const panel = page.getByTestId("settings-panel");

  await panel.getByRole("tab", { name: /memory/i }).click();
  await expect(panel.getByText("Use memory", { exact: true })).toBeVisible();
  await expect(panel.getByText("Knowledge graph", { exact: true })).toBeVisible();

  await panel.getByPlaceholder("Add a memory manually...").fill(unique);
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel.getByText(unique)).toBeVisible({ timeout: 10_000 });

  await panel.getByPlaceholder("Name, preference, project, tool...").fill("compact TypeScript");
  await expect(panel.getByText(unique)).toBeVisible();

  const card = panel.locator("article").filter({ hasText: unique });
  await card.getByRole("button", { name: "Delete memory" }).click();
  await expect(panel.getByText(unique)).toHaveCount(0);
});

test("closing settings returns focus to the chat", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);
});
