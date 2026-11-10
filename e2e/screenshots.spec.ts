import { test, expect, type Page } from "@playwright/test";

/** Regenerates the README images in docs/screenshots. */
const shot = (name: string) => `docs/screenshots/${name}.png`;

async function diagram(page: Page, type: string, file: string) {
  await page
    .getByRole("group", { name: "Diagram type" })
    .getByRole("button", { name: type, exact: true })
    .click();
  await page.locator(".diagram-panel").screenshot({ path: shot(file) });
}

test.use({ viewport: { width: 1440, height: 1000 } });

test("README screenshots", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("review-helper-theme", "light");
      localStorage.setItem("review-helper:diff-layout", "split");
    } catch {}
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Give saved articles a home" })).toBeVisible();
  await page.screenshot({ path: shot("overview"), clip: { x: 0, y: 0, width: 1440, height: 1000 } });

  await diagram(page, "Use case", "usecase");
  await diagram(page, "Sequence", "sequence");
  await diagram(page, "Data model", "data-model");
  await diagram(page, "Tests", "tests");

  await page.getByRole("button", { name: /Diffs/ }).click();
  const routes = page.locator(".diff-block", {
    has: page.getByRole("table", { name: "Side-by-side diff for api/routes/collections.py" }),
  });
  await routes.screenshot({ path: shot("split-diff") });
  const shared = page.locator(".diff-block", {
    has: page.getByRole("table", { name: "Side-by-side diff for api/app.py" }),
  });
  await shared.screenshot({ path: shot("hunk-split") });
});
