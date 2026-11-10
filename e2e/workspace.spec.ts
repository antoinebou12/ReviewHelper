import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page, request }) => {
  await request.put("/api/reviews/demo/progress", { data: { sections: [] } });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Give saved articles a home" }),
  ).toBeVisible();
});

test("feature sections connect layers, search, and expose original diffs", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Create a collection", exact: true }),
  ).toBeVisible();
  const map = page.getByRole("group", { name: "Project change map" });
  await expect(
    map.getByRole("button", {
      name: "web/pages/Collections.tsx, Added",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    map.getByRole("button", {
      name: "api/routes/collections.py, Added",
      exact: true,
    }),
  ).toBeVisible();
  await map
    .getByRole("button", {
      name: "api/services/collections.py, Added",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("table", { name: "Diff for api/services/collections.py" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search sections" }).fill("retire");
  await expect(
    page.getByRole("button", { name: /Retire the local save button/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Create a collection/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /Retire the local save button/ })
    .click();
  await page.getByRole("button", { name: /Diffs/ }).click();
  await expect(
    page.getByRole("table", { name: "Diff for web/components/LegacySave.tsx" }),
  ).toBeVisible();
  await expect(page.locator(".deleted-line")).toHaveCount(8);
  await page
    .getByRole("textbox", { name: "Search sections" })
    .fill("no-such-change");
  await expect(
    page.getByText("No sections match", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
});

test("C4, filters, zoom and SVG export work", async ({ page }) => {
  await page.getByRole("button", { name: "C4", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "C4 container change map" }),
  ).toBeVisible();
  await expect(
    page.getByText("[Container · directory-derived]", { exact: true }),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  // Default: changed files plus nearby unchanged files, never the whole tree.
  const scope = page.getByRole("group", { name: "Files shown" });
  // Only connected files: imports on changed lines and name matches, each with its reason.
  await expect(page.locator(".file-node.nearby")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "web/lib/api.ts, Unchanged" }),
  ).toContainText("Imported by useCollections.ts");
  await expect(
    page.getByRole("button", { name: "web/pages/Settings.tsx, Unchanged" }),
  ).toHaveCount(0);
  await scope.getByRole("button", { name: "Changed" }).click();
  await expect(page.locator(".file-node")).toHaveCount(13);
  await expect(page.locator(".file-node.unchanged")).toHaveCount(0);
  await scope.getByRole("button", { name: "All" }).click();
  await expect(
    page.getByRole("button", { name: "web/pages/Settings.tsx, Unchanged" }),
  ).toBeVisible();
  await scope.getByRole("button", { name: /Nearby/ }).click();
  await page.getByRole("checkbox", { name: "Focus section" }).check();
  // The section's 7 files plus the unchanged files around them.
  await expect(
    page.locator(".file-node.added, .file-node.modified, .file-node.deleted"),
  ).toHaveCount(7);
  await page.getByRole("checkbox", { name: "Focus section" }).uncheck();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("120%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset zoom" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG" }).click();
  expect((await download).suggestedFilename()).toBe("review-helper.svg");
});

test("review progress persists across reload and comments remain scoped", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reviewed", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Reviewed", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Prepare collection storage/ })
    .click();
  await page.getByRole("button", { name: /Comments/ }).click();
  await expect(page.locator(".discussion-view")).toContainText(
    "Existing bookmarks will have no collection.",
  );
  await expect(page.locator(".discussion-view")).not.toContainText(
    "Can we reject an empty name",
  );
  await expect(page.locator(".discussion-view")).toContainText(
    "PR-wide discussion",
  );
});

test("URL import errors, settings, and review prompts are usable", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open a PR", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Pull request URL" })
    .fill("https://example.com/unsafe");
  await page.getByRole("button", { name: "Open review", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Supported hosts");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("GITHUB_TOKEN");
  await expect(page.getByRole("link", { name: "ReDoc" })).toHaveAttribute(
    "href",
    "/redoc",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Review with AI", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Review prompt" }),
  ).toHaveValue(/read_section/);
  await expect(page.getByRole("dialog")).toContainText("Planned");
});

test("successful URL import renders provider data without executing HTML", async ({
  page,
}) => {
  const review = await (await page.request.get("/api/demo")).json();
  review.title = "<script>window.injected=true</script>";
  review.provider = "github";
  review.url = "https://github.com/acme/app/pull/12";
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: review }),
  );
  await page.getByRole("button", { name: "Open a PR", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Pull request URL" })
    .fill(review.url);
  await page.getByRole("button", { name: "Open review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: review.title, exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
});

for (const theme of ["light", "dark"]) {
  test(`${theme} theme accessibility and screenshot`, async ({ page }) => {
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({
      path: `docs/screenshots/${theme}.png`,
      fullPage: true,
    });
    await page.keyboard.press("/");
    await expect(
      page.getByRole("textbox", { name: "Search sections" }),
    ).toBeFocused();
  });
}

test("mobile layout keeps controls visible without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Open a PR" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: /Save articles to collections/ })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Save articles to collections",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/mobile.png",
    fullPage: true,
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("use case, sequence and class views explain the selected section", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use case", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Use case diagram" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use case Save articles to collections" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Save articles to collections" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Create a collection/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Sequence", exact: true }).click();
  const sequence = page.getByRole("group", { name: "Sequence diagram" });
  await expect(sequence).toBeVisible();
  await expect(sequence.locator(".seq-message")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Class", exact: true }).click();
  const classes = page.getByRole("group", { name: "Class diagram" });
  await expect(
    classes.getByText("+ create_collection()", { exact: true }),
  ).toBeVisible();
  await expect(
    classes.getByText("+ Collection", { exact: true }),
  ).toBeVisible();
  await classes
    .getByRole("button", { name: /api\/routes\/collections.py/ })
    .click();
  await expect(
    page.getByRole("table", { name: "Diff for api/routes/collections.py" }),
  ).toBeVisible();
});

test("diffs switch to side by side and comments render Markdown safely", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /Save articles to collections/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Diffs/ }).click();
  await page.getByRole("button", { name: "Split" }).first().click();
  const split = page.getByRole("table", {
    name: "Side-by-side diff for api/services/bookmarks.py",
  });
  await expect(split).toBeVisible();
  // The removed signature sits on the left, its replacement on the same row to the right.
  const row = split.locator("tr", { hasText: "async def save(user_id, url):" });
  await expect(row).toContainText(
    "async def save(user_id, url, collection_id):",
  );
  await page.reload();
  await page.getByRole("button", { name: /Diffs/ }).click();
  await expect(
    page.getByRole("button", { name: "Split" }).first(),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Unified" }).first().click();
  await page.getByRole("button", { name: /Comments/ }).click();
  const discussion = page.locator(".discussion-view");
  await discussion.getByText("Automated comment · show details").click();
  await expect(
    discussion.getByRole("cell", { name: "reading-room" }),
  ).toBeVisible();
  await expect(
    discussion.getByRole("link", { name: "Open preview" }),
  ).toHaveAttribute("href", "https://preview.example.com/");
  await expect(
    discussion.locator("strong", { hasText: "reading-room" }),
  ).toBeVisible();
  await expect(discussion).not.toContainText("[pb]:");
  await expect(discussion).not.toContainText("eyJoaWRk");
  await expect(discussion).not.toContainText("alert(1)");
  await expect(discussion.locator("script")).toHaveCount(0);
});

test("only diagrams with content are offered, including data model and tests", async ({
  page,
}) => {
  await page.goto("/");
  const types = page.getByRole("group", { name: "Diagram type" });
  await types.getByRole("button", { name: "Data model" }).click();
  const data = page.getByRole("group", { name: "Data model diagram" });
  await expect(data.getByText("+ Collection", { exact: true })).toBeVisible();
  await expect(data.getByText("referenced table")).toBeVisible();
  await types.getByRole("button", { name: "Tests" }).click();
  await expect(
    page
      .getByRole("group", { name: "Test map" })
      .getByRole("button", { name: "tests/api/test_collections.py, added" }),
  ).toBeVisible();
  // The clean-up section has no recorded flow and no schema change: no sequence or data model.
  await page
    .getByRole("button", { name: /Retire the local save button/ })
    .click();
  for (const name of ["Sequence", "Data model"])
    await expect(types.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  // It does change code without changing a test, so the Tests view (still selected) flags it.
  await expect(
    types.getByRole("button", { name: "Tests", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Test map" })).toContainText(
    "No changed test covers this",
  );
});

test("a one-feature PR gets a smaller interface", async ({ page }) => {
  const review = await (await page.request.get("/api/demo")).json();
  const keep = review.sections[2];
  review.sections = [keep];
  review.files = review.files.filter((f: any) => keep.files.includes(f.path));
  review.comments = [];
  review.relationships = [];
  await page.route("**/api/demo", (route) => route.fulfill({ json: review }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: keep.title })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Review sections" }),
  ).toHaveCount(0);
  await expect(page.getByText(/SECTION 01 OF 01/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Comments/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Next section/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("textbox", { name: "Search sections" }),
  ).toHaveCount(0);
});

test("files read foundations first and J/K move between sections", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Diffs/ }).click();
  const headings = page.locator(
    ".diffs-view .diff-heading > span:first-of-type",
  );
  // Data model, then service, API, client state, UI, and the test last.
  await expect(headings).toHaveText([
    "db/models/collection.py",
    "api/services/collections.py",
    "api/app.py",
    "api/routes/collections.py",
    "web/hooks/useCollections.ts",
    "web/pages/Collections.tsx",
    "tests/api/test_collections.py",
  ]);
  await page.locator("body").press("j");
  await expect(
    page.getByRole("heading", { name: "Save articles to collections" }),
  ).toBeVisible();
  await page.locator("body").press("k");
  await expect(
    page.getByRole("heading", { name: "Create a collection" }),
  ).toBeVisible();
});

test("a file split across sections shows each section only its hunks", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", {
      name: "api/app.py, Modified, split across 2 sections",
    }),
  ).toContainText("split");
  await page.getByRole("button", { name: /Diffs/ }).click();
  const created = page.getByRole("table", { name: "Diff for api/app.py" });
  await expect(created).toContainText("collections.router");
  await expect(created).not.toContainText("legacy_save");
  const block = page.locator(".diff-block", { has: created });
  await expect(block).toContainText("This section reviews 1 of 2 hunks");
  // Jump to the section that owns the rest of the file.
  await block
    .getByRole("button", { name: "Retire the local save button" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Retire the local save button" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Diffs/ }).click();
  const retired = page.getByRole("table", { name: "Diff for api/app.py" });
  await expect(retired).toContainText("legacy_save");
  await expect(retired).not.toContainText("collections.router");
  // The line comment in the second hunk belongs to this section only.
  await page.getByRole("button", { name: /Comments/ }).click();
  await expect(page.locator(".discussion-view")).toContainText(
    "legacy save endpoint",
  );
  await page.locator("body").press("k");
  await page.locator("body").press("k");
  await page.locator("body").press("k");
  await expect(
    page.getByRole("heading", { name: "Create a collection" }),
  ).toBeVisible();
  await expect(page.locator(".discussion-view")).not.toContainText(
    "legacy save endpoint",
  );
});
