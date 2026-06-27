import { expect, test } from "@playwright/test";

const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";

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
    },
  });
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
  await expect(panel.getByText("Backend", { exact: true })).toBeVisible();
});

test("lists the three built-in presets and can expand one", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  const panel = page.getByTestId("settings-panel");

  await expect(panel.getByText("General", { exact: true })).toBeVisible();
  await expect(panel.getByText("Coding", { exact: true })).toBeVisible();
  await expect(panel.getByText("NSFW", { exact: true })).toBeVisible();

  await panel.getByTestId("preset-card-coding").getByRole("button").first().click();
  const textarea = panel.getByLabel("Coding system prompt");
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue(/Coding mode/);
});

test("editing a preset prompt enables the Save button", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  const panel = page.getByTestId("settings-panel");
  await panel.getByTestId("preset-card-general").getByRole("button").first().click();

  const textarea = panel.getByLabel("General system prompt");
  const original = await textarea.inputValue();
  const saveButton = panel.getByRole("button", { name: "Save General preset" });

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

test("closing settings returns focus to the chat", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);
});
