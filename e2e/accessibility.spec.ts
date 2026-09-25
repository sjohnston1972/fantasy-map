// Accessibility checks (spec: "All controls usable by keyboard; text meets contrast
// guidelines"): the axe checker on the map page, with its editing tools and palette open,
// and on the gallery; and a map made, edited and saved with the keyboard alone.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const LINK = "/?map=2.acm9.p.35.50.60.5";

async function problems(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

test.describe("accessibility", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "one engine is enough for the checker");

  test("the map page passes the checker, with the editing tools and palette open", async ({ page }) => {
    await page.goto(LINK);
    await page.waitForFunction(() => document.querySelectorAll("#map image").length > 100);
    expect(await problems(page)).toEqual([]);
    await page.locator("#edit-mode").click();
    await page.locator("#add-open").click();
    await expect(page.locator("#pal-grid button").first()).toBeVisible();
    expect(await problems(page)).toEqual([]);
  });

  test("a map can be made, edited and saved with the keyboard alone", async ({ page }) => {
    type Edits = { moved: Record<string, unknown>; deleted: string[]; added: Record<string, unknown> };
    const state = () => page.evaluate(() => (window as unknown as { inkMap: { state(): { edits: Edits; picked: string[] } } }).inkMap.state());
    const press = async (sel: string, key = "Enter") => {
      await page.locator(sel).focus();
      await page.keyboard.press(key);
    };
    await page.goto(LINK);
    await page.waitForFunction(() => document.querySelectorAll("#map image").length > 100);
    // A new map from the seed box.
    await page.locator("#seed").fill("12345");
    await page.keyboard.press("Enter");
    await expect(page.locator("#caption")).toContainText("Seed 12345");
    await page.waitForFunction(() => document.querySelectorAll("#map image").length > 100);
    // Edit mode, then pick with N, move with an arrow, delete, and undo.
    await press("#edit-mode");
    await expect(page.locator("#edit-tools")).toBeVisible();
    await expect(page.locator("#map")).toBeFocused();
    await page.keyboard.press("n");
    expect((await state()).picked).toHaveLength(1);
    await page.keyboard.press("ArrowRight");
    expect(Object.keys((await state()).edits.moved)).toHaveLength(1);
    await page.keyboard.press("Delete");
    expect((await state()).edits.deleted).toHaveLength(1);
    await page.keyboard.press("Control+z");
    expect((await state()).edits.deleted).toHaveLength(0);
    // Add a drawing from the palette: choose it, then Enter on the map places it.
    await press("#add-open");
    await press("#pal-grid button >> nth=0");
    await press("#map");
    expect(Object.keys((await state()).edits.added)).toHaveLength(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("#map")).not.toHaveClass(/placing/);
    // Save the SVG.
    const [svg] = await Promise.all([page.waitForEvent("download"), press("#export-svg")]);
    expect(svg.suggestedFilename()).toBe("ink-map-12345.svg");
  });

  test("the gallery passes the checker", async ({ page }) => {
    await page.goto("/gallery/");
    await page.waitForLoadState("networkidle");
    expect(await problems(page)).toEqual([]);
  });
});
