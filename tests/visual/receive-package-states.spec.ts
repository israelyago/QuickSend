import { expect, test } from "@playwright/test";

type StateName = "preview" | "downloading" | "completed";

const states: Array<{ state: StateName; snapshot: string }> = [
  { state: "preview", snapshot: "receive-package-preview.png" },
  { state: "downloading", snapshot: "receive-package-downloading.png" },
  { state: "completed", snapshot: "receive-package-completed.png" },
];

for (const item of states) {
  test(`receive package ${item.state} state`, async ({ page }) => {
    await page.goto(`/src/test/visual/package-states.html?state=${item.state}`);

    const root = page.locator("#visual-root");
    await expect(root).toBeVisible();
    await expect(root).toHaveScreenshot(item.snapshot, {
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });
  });
}

