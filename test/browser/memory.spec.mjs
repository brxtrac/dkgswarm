import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page, request }) => {
  await request.post("/__fixture/unavailable", { data: { value: false } });
  await request.post("/__fixture/delay", { data: {} });
  // Only the task-owned localhost app is automated. External fonts/assets are blocked.
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
});

test("homepage displays actual collection and active-connection aggregates", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-stat="sources"]')).toHaveText("1");
  await expect(page.locator('[data-stat="shared"]')).toHaveText("1");
  await expect(page.locator('[data-stat="active24h"]')).toHaveText("0");
  await expect(page.locator('[data-stat="active7d"]')).toHaveText("0");
  await expect(page.locator('[data-stat-note]')).toHaveCount(0);
});

test("search finds unloaded shared entries, applies filters, opens details and clears", async ({ page }, info) => {
  await page.goto("/memory");
  await expect(page.locator("#entries .entry")).toHaveCount(80);
  await expect(page.locator("#entries")).not.toContainText("Hidden needle");
  await page.locator("#search").fill("needle");
  await page.locator("#source-filter").fill("source.example");
  await page.locator("#from-filter").fill("2026-09-01");
  await page.locator("#to-filter").fill("2026-09-01");
  await page.getByRole("button", { name: "Search shared memory", exact: true }).click();
  await expect(page.locator("#entries .entry")).toHaveCount(1);
  await expect(page.locator("#entries")).toContainText("Hidden needle beyond first page");
  await page.locator("#entries .entry").click();
  await expect(page.locator("#detail")).toBeVisible();
  await expect(page.locator("#detail-text")).toHaveText("Hidden needle beyond first page");
  await expect(page.locator("#detail-source")).toHaveAttribute("href", "https://source.example/needle");
  await expect(page.locator("#detail-date")).toContainText("2026-09-01T12:00:00Z");
  await page.getByRole("button", { name: "Close memory detail" }).click();
  await page.screenshot({ path: info.outputPath("memory-search.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("#entries .entry")).toHaveCount(80);
  await page.getByRole("button", { name: "Load more shared entries" }).click();
  await expect(page.locator("#entries .entry")).toHaveCount(85);
  await expect(page.locator("#load-more")).toBeHidden();
});

test("failed next page preserves loaded entries and resumes at the same offset", async ({ page, request }) => {
  await page.goto("/memory");
  await expect(page.locator("#entries .entry")).toHaveCount(80);
  await request.post("/__fixture/unavailable", { data: { value: true } });
  await page.getByRole("button", { name: "Load more shared entries" }).click();
  await expect(page.locator("#feed-status")).toHaveText("Shared memory could not load");
  await expect(page.locator("#entries .entry")).toHaveCount(80);
  await request.post("/__fixture/unavailable", { data: { value: false } });
  await page.getByRole("button", { name: "Retry loading more" }).click();
  await expect(page.locator("#entries .entry")).toHaveCount(85);
});

test("a newer search wins over an older slow request and works on a narrow viewport", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memory");
  await expect(page.locator("#entries .entry")).toHaveCount(80);
  await request.post("/__fixture/delay", { data: { term: "needle", ms: 500 } });
  const started = page.waitForRequest(request => new URL(request.url()).searchParams.get("q") === "needle");
  await page.locator("#search").fill("needle");
  await page.getByRole("button", { name: "Search shared memory", exact: true }).click();
  await started;
  await page.locator("#search").fill("ordinary");
  await page.getByRole("button", { name: "Search shared memory", exact: true }).click();
  await expect(page.locator("#entries .entry")).toHaveCount(80);
  await expect(page.locator("#entries")).not.toContainText("Hidden needle");
  await expect(page.locator("#feed-status")).toContainText("80 shared entries loaded");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
