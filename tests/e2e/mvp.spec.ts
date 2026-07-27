import path from "node:path";
import { expect, Page, test } from "@playwright/test";

async function hasInputValue(page: Page, value: string) {
  return page.locator("input").evaluateAll((inputs, expectedValue) =>
    inputs.some((input) => (input as HTMLInputElement).value === expectedValue),
  value);
}

async function hasTextareaValue(page: Page, value: string) {
  return page.locator("textarea").evaluateAll((textareas, expectedValue) =>
    textareas.some((textarea) => (textarea as HTMLTextAreaElement).value === expectedValue),
  value);
}

test("generates, edits, saves, reopens, and deletes a draft spec", async ({ page }) => {
  const existingSpecs = await page.request.get("/api/specs");
  for (const savedSpec of await existingSpecs.json()) {
    await page.request.delete(`/api/specs/${savedSpec.id}`);
  }

  await page.goto("/");
  await page.getByRole("button", { name: "Load Example" }).click();
  await page.getByRole("button", { name: "Generate Spec" }).click();

  await expect(page.getByText("Generated Events")).toBeVisible();
  await expect(page.getByText("Platform Ad Payload Enrichment")).toBeVisible();
  await expect(page.getByText("Ad Payload Definition", { exact: true })).toBeVisible();
  await expect(page.getByText("Game_Start")).toBeVisible();

  const firstTrigger = page.locator("textarea").first();
  await firstTrigger.fill("Edited trigger for test review.");
  await expect(firstTrigger).toHaveValue("Edited trigger for test review.");

  const firstPayloadDescription = page.locator('textarea[aria-label*=" description"]').first();
  await firstPayloadDescription.fill("Edited payload description for test review.");
  await expect(firstPayloadDescription).toHaveValue("Edited payload description for test review.");

  const firstPayloadExample = page.locator('textarea[aria-label*=" example"]').first();
  await firstPayloadExample.fill("edited_payload_example");
  await expect(firstPayloadExample).toHaveValue("edited_payload_example");

  const firstPayloadName = page.getByLabel(/payload name 1/).first();
  await firstPayloadName.fill("");
  await firstPayloadName.click();
  await page.keyboard.type("review_payload");
  await expect(firstPayloadName).toBeFocused();
  await expect(firstPayloadName).toHaveValue("review_payload");

  await page.getByPlaceholder("Filter ad payloads...").fill("Rewarded placement");
  await expect(page.getByText("Applies to all rewarded platform ad events.")).toBeVisible();
  await page.getByTestId("ad-payload-description").fill("Unified rewarded placement description.");
  await page.getByTestId("ad-payload-example").fill("rewarded_home, rewarded_end");

  await page.getByRole("button", { name: "Add Event" }).click();
  expect(await hasInputValue(page, "Custom_Event_12")).toBe(true);

  await page.getByRole("button", { name: "Save Spec" }).click();
  await expect(page.getByText(/Saved /)).toBeVisible();

  const savedSpecsAfterSave = await page.request.get("/api/specs");
  const savedSpecSummaries = await savedSpecsAfterSave.json();
  const savedSpecDetail = await page.request.get(`/api/specs/${savedSpecSummaries[0].id}`);
  const savedSpec = await savedSpecDetail.json();
  const rewardedPlacementRows = savedSpec.platformAdPayloads.filter(
    (payload: { adFamily: string; canonicalPayloadName: string }) =>
      payload.adFamily === "Rewarded" && payload.canonicalPayloadName === "placement",
  );
  expect(rewardedPlacementRows.length).toBeGreaterThan(1);
  expect(
    rewardedPlacementRows.every(
      (payload: { description: string; example: string }) =>
        payload.description === "Unified rewarded placement description." && payload.example === "rewarded_home, rewarded_end",
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Spec Viewer" }).click();
  await expect(page.getByText("Spec Viewer").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sample Match Timed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Gameplay spec group" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Economy spec group" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View IAP spec group" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View IAA spec group" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gameplay" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Game_Start" })).toBeVisible();

  await page.getByRole("button", { name: "View Economy spec group" }).click();
  await expect(page.getByRole("heading", { name: "Economy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Currency_Transaction" })).toBeVisible();

  await page.getByRole("button", { name: "View IAA spec group" }).click();
  await expect(page.getByRole("heading", { name: "IAA" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ad_Call_Rewarded" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Unified rewarded placement description." })).toHaveCount(4);
  await expect(page.getByRole("cell", { name: "rewarded_home, rewarded_end" })).toHaveCount(4);

  await page.getByRole("button", { name: "Saved Specs" }).click();
  await expect(page.getByText("Saved Game Specs")).toBeVisible();
  await expect(page.getByText("Sample Match Timed")).toBeVisible();

  await page.getByRole("button", { name: "Duplicate Sample Match Timed" }).click();
  await expect(page.getByText("Duplicated Sample Match Timed (Copy)")).toBeVisible();
  await expect(page.getByText("Sample Match Timed (Copy)", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await expect(page.getByText("Saved spec loaded")).toBeVisible();
  expect(await hasTextareaValue(page, "Edited trigger for test review.")).toBe(true);
  expect(await hasTextareaValue(page, "Edited payload description for test review.")).toBe(true);
  expect(await hasTextareaValue(page, "edited_payload_example")).toBe(true);

  await page.getByRole("button", { name: "Saved Specs" }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No saved specs yet")).toBeVisible();
});

test("imports an existing CSV spec from saved specs", async ({ page }) => {
  const existingSpecs = await page.request.get("/api/specs");
  for (const savedSpec of await existingSpecs.json()) {
    await page.request.delete(`/api/specs/${savedSpec.id}`);
  }

  await page.goto("/");
  await page.getByRole("button", { name: "Saved Specs" }).click();
  await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), "tests/fixtures/import-spec.csv"));
  await expect(page.getByRole("heading", { name: "Import Spec Details" })).toBeVisible();
  await page.getByLabel("Game Name").fill("Imported Fixture Game");
  await page.getByLabel("Genre").pressSequentially("Puzzle CSV");
  await expect(page.getByLabel("Genre")).toHaveValue("Puzzle CSV");
  await page.getByLabel("Genre").fill("");
  await page.getByRole("button", { name: "Save Imported Spec" }).click();

  await expect(page.getByText("Imported Imported Fixture Game")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Imported Fixture Game" })).toBeVisible();
  expect(await hasInputValue(page, "Game_Start")).toBe(true);

  await page.getByRole("button", { name: "Saved Specs" }).click();
  await expect(page.getByText("Saved Game Specs")).toBeVisible();
  await expect(page.getByText("Imported Fixture Game", { exact: true })).toBeVisible();
  await expect(page.getByText("Unspecified", { exact: true })).toBeVisible();

  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No saved specs yet")).toBeVisible();
});
