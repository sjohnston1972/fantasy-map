// Browser tests of the map page: the gestures people actually use (click, drag, box-select,
// copy and paste, resize, add, zoom), in every browser engine, plus the phone and tablet
// layouts. Each test drives real mouse or touch input, the way the page is really used.

import { expect, test, type Page } from "@playwright/test";

const LINK = "/?map=2.acm9.p.35.50.60.5";

// Fail any test whose page throws an error.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  (page as Page & { errors: string[] }).errors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { errors: string[] }).errors).toEqual([]);
});

async function open(page: Page, link = LINK) {
  await page.goto(link);
  // Drawn, redrawn with the symbol packs, and then with their pre-drawn pictures.
  await page.waitForFunction(() => document.querySelectorAll("#map image").length > 100);
}

async function editMode(page: Page) {
  await page.locator("#edit-mode").click();
  await expect(page.locator("#edit-tools")).toBeVisible();
}

// The page's own idea of where items are (browsers disagree about SVG boxes; see
// screenBox in src/app/main.ts).
type Box = { x: number; y: number; width: number; height: number };
declare global {
  interface Window {
    inkMap: { screenBox(key: string): Box | null; keys(): string[] };
  }
}

// An item well inside the visible map with nothing else near it, so a click there can only
// mean it.
async function isolatedItem(page: Page, role?: string): Promise<string> {
  const key = await page.evaluate((role) => {
    const map = document.querySelector("#map")!.getBoundingClientRect();
    const view = { left: Math.max(map.left, 0), top: Math.max(map.top, 0), right: Math.min(map.right, innerWidth), bottom: Math.min(map.bottom, innerHeight) };
    const rects = window.inkMap.keys().map((k) => [k, window.inkMap.screenBox(k)!] as const);
    for (const pad of [16, 8, 2]) {
      for (const [k, r] of rects) {
        const el = document.querySelector<SVGElement>(`#map [data-key="${k}"]`);
        if (!el || (role && el.dataset.role !== role)) continue;
        if (k.startsWith("label:") || r.width < 12) continue;
        // Room around it for the gestures: a share of the visible map on small screens.
        const mx = Math.min(60, (view.right - view.left) * 0.12);
        const my = Math.min(60, (view.bottom - view.top) * 0.12);
        if (r.x < view.left + mx || r.x + r.width > view.right - mx * 1.7 || r.y < view.top + my || r.y + r.height > view.bottom - my * 1.7) continue;
        const clash = rects.some(([o, q]) => o !== k && q.x < r.x + r.width + pad && q.x + q.width > r.x - pad && q.y < r.y + r.height + pad && q.y + q.height > r.y - pad);
        if (!clash) return k;
      }
    }
    return null;
  }, role);
  expect(key, "an isolated item to work with").toBeTruthy();
  return key!;
}

const item = (page: Page, key: string) => page.locator(`#map [data-key="${key}"]`);
async function box(page: Page, key: string): Promise<Box> {
  const b = await page.evaluate((k) => window.inkMap.screenBox(k), key);
  expect(b, key).toBeTruthy();
  return b!;
}
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

const picked = (page: Page) => page.locator("#map .selected").evaluateAll((els) => els.map((e) => (e as SVGElement).dataset.key));

test.describe("everywhere", () => {
  test("draws the same map in every browser (share links rebuild it exactly)", async ({ page }) => {
    await open(page);
    await expect(page.locator("#caption")).toContainText("Map check pe41gf");
    await open(page, "/?map=1.acm9.p.35.50.60.5");
    await expect(page.locator("#caption")).toContainText("Map check 46mhsd");
  });

  test("keeps the map its own shape whatever the hint says", async ({ page }) => {
    await open(page);
    await page.locator("#edit-mode").click();
    const shape = async () => { const b = (await page.locator("#map").boundingBox())!; return b.width / b.height; };
    const before = await shape();
    await page.locator("#edit-hint").evaluate((el) => (el.textContent = "A very long hint ".repeat(20)));
    expect(await shape()).toBeCloseTo(before, 3);
  });

  test("keeps the hint and zoom controls off the map", async ({ page }) => {
    await open(page);
    await page.locator("#edit-mode").click();
    const map = (await page.locator("#map-box").boundingBox())!;
    for (const sel of [".zoom-ctl", "#edit-hint"]) {
      const b = (await page.locator(sel).boundingBox())!;
      expect(b.y + b.height, sel).toBeLessThanOrEqual(map.y + 1);
      expect(b.x, sel).toBeGreaterThanOrEqual(map.x - 1);
      expect(b.x + b.width, sel).toBeLessThanOrEqual(map.x + map.width + 1);
    }
  });

  test("fits the screen without sideways scrolling", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const mapBox = (await page.locator("#map-box").boundingBox())!;
    expect(mapBox.width).toBeGreaterThan(200);
  });
});

test.describe("one screen on a computer", () => {
  test.skip(({ isMobile }) => !!isMobile, "desktop windows only");

  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080]]) {
    test(`fits the settings and the map in a ${width} by ${height} window, editing or not`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page);
      const fits = () => page.evaluate(() => {
        const d = document.documentElement;
        const panel = document.querySelector("#settings")!;
        return { page: d.scrollHeight <= innerHeight && d.scrollWidth <= innerWidth, panel: panel.scrollHeight <= panel.clientHeight };
      });
      expect(await fits()).toEqual({ page: true, panel: true });
      const map = (await page.locator("#map-box").boundingBox())!;
      expect(map.y + map.height).toBeLessThanOrEqual(height);
      await editMode(page);
      await page.locator("#add-open").click();
      expect((await fits()).page).toBe(true);
    });
  }
});

test.describe("phone and tablet", () => {
  test.skip(({ isMobile }) => !isMobile, "touch screens only");

  test("shows the map before the settings on a phone", async ({ page, viewport }) => {
    test.skip(viewport!.width > 760, "phone layout only");
    await open(page);
    const map = (await page.locator("#map-box").boundingBox())!;
    const panel = (await page.locator("#settings").boundingBox())!;
    expect(map.y).toBeLessThan(panel.y);
  });

  test("taps pick items in edit mode, and zoom buttons work", async ({ page }) => {
    await open(page);
    await editMode(page);
    const key = await isolatedItem(page);
    const c = centre(await box(page, key));
    await page.touchscreen.tap(c.x, c.y);
    await expect.poll(() => picked(page)).toEqual([key]);
    await page.locator("#zoom-in").tap();
    await expect(page.locator("#zoom-level")).toHaveText("150%");
  });
});

test.describe("editing with a mouse", () => {
  test.skip(({ isMobile }) => isMobile, "mouse gestures");

  test("picks a drawing by clicking inside its outline, even in a gap of the ink", async ({ page }) => {
    await open(page);
    await editMode(page);
    const key = await isolatedItem(page, "mountain");
    const c = centre(await box(page, key));
    // The test drawings are hollow: the very middle has no ink.
    await page.mouse.click(c.x, c.y);
    await expect.poll(() => picked(page)).toEqual([key]);
  });

  test("drags an item exactly with the pointer, and undo puts it back", async ({ page }) => {
    await open(page);
    await editMode(page);
    const key = await isolatedItem(page);
    const b0 = await box(page, key);
    await drag(page, centre(b0), { x: centre(b0).x + 60, y: centre(b0).y + 40 });
    const b1 = await box(page, key);
    expect(b1.x - b0.x).toBeCloseTo(60, 0);
    expect(b1.y - b0.y).toBeCloseTo(40, 0);
    await expect(page).toHaveURL(/&e=/);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => Math.round((await box(page, key)).x - b0.x)).toBe(0);
    await page.keyboard.press("Control+y");
    await expect.poll(async () => Math.round((await box(page, key)).x - b0.x)).toBe(60);
    await page.locator("#undo").click();
    await page.locator("#redo").click();
    await expect.poll(async () => Math.round((await box(page, key)).x - b0.x)).toBe(60);
  });

  test("picking never moves the map under the pointer", async ({ page }) => {
    await open(page);
    await editMode(page);
    const top0 = (await page.locator("#map").boundingBox())!.y;
    const key = await isolatedItem(page, "mountain");
    await page.mouse.click(centre(await box(page, key)).x, centre(await box(page, key)).y);
    await expect.poll(() => picked(page)).toEqual([key]);
    expect((await page.locator("#map").boundingBox())!.y).toBeCloseTo(top0, 0);
    // Nor does picking a name (which opens the wording box).
    const label = await page.evaluate(() => window.inkMap.keys().find((k) => k.startsWith("label:"))!);
    const lc = centre(await box(page, label));
    await page.mouse.click(lc.x, lc.y);
    await expect(page.locator("#rename")).toBeVisible();
    expect((await page.locator("#map").boundingBox())!.y).toBeCloseTo(top0, 0);
  });

  test("the bar above picked items acts on them", async ({ page }) => {
    await open(page);
    await editMode(page);
    const key = await isolatedItem(page, "mountain");
    const b = await box(page, key);
    await page.mouse.click(centre(b).x, centre(b).y);
    const bar = page.locator("#sel-bar");
    await expect(bar).toBeVisible();
    const barBox = (await bar.boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThan(b.y); // above the item, not covering it
    const before = b.width;
    await bar.locator("#bigger").click();
    await expect.poll(async () => (await box(page, key)).width).toBeGreaterThan(before * 1.1);
    await bar.locator("#delete").click();
    await expect(item(page, key)).toHaveCount(0);
    await expect(bar).toBeHidden();
  });

  test("Select area picks a group, and the group then drags together", async ({ page }) => {
    await open(page);
    await editMode(page);
    const key = await isolatedItem(page, "mountain");
    const c = centre(await box(page, key));
    await page.locator("#select-area").click();
    await drag(page, { x: c.x - 70, y: c.y - 60 }, { x: c.x + 70, y: c.y + 60 });
    await expect(page.locator("#select-area")).toHaveAttribute("aria-pressed", "false");
    const group = await picked(page);
    expect(group.length).toBeGreaterThan(1);
    expect(group).toContain(key);
    // Measured against the map itself: the page may settle by a fraction of a pixel meanwhile.
    // (All at once: a group can be a couple of hundred items.)
    const onMap = () =>
      page.evaluate((keys) => {
        const m = document.querySelector("#map")!.getBoundingClientRect();
        return keys.map((k) => {
          const b = window.inkMap.screenBox(k!)!;
          return { x: b.x - m.x, y: b.y - m.y };
        });
      }, group);
    const before = await onMap();
    await drag(page, c, { x: c.x + 50, y: c.y + 30 });
    const after = await onMap();
    after.forEach((a, i) => {
      expect(a.x - before[i].x).toBeCloseTo(50, 0);
      expect(a.y - before[i].y).toBeCloseTo(30, 0);
    });
  });

  test("copies and pastes a group at the pointer, and the copies drag", async ({ page }) => {
    await open(page);
    await editMode(page);
    const key = await isolatedItem(page, "mountain");
    const c = centre(await box(page, key));
    await page.keyboard.down("Shift");
    await drag(page, { x: c.x - 60, y: c.y - 50 }, { x: c.x + 60, y: c.y + 50 });
    await page.keyboard.up("Shift");
    const group = (await picked(page)).filter((k) => !k!.startsWith("label:"));
    expect(group.length).toBeGreaterThan(0);
    await page.keyboard.press("Control+c");
    await page.mouse.move(c.x + 150, c.y + 120);
    await page.keyboard.press("Control+v");
    const pasted = await picked(page);
    expect(pasted.length).toBe(group.length);
    expect(pasted.every((k) => k!.startsWith("add:"))).toBe(true);
    const p0 = await box(page, pasted[0]!);
    await drag(page, centre(p0), { x: centre(p0).x - 40, y: centre(p0).y + 25 });
    const p1 = await box(page, pasted[0]!);
    expect(p1.x - p0.x).toBeCloseTo(-40, 0);
  });

  test("resizes by dragging a corner of the box, keeping the opposite corner still", async ({ page }) => {
    await open(page);
    await editMode(page);
    const key = await isolatedItem(page, "mountain");
    const b0 = await box(page, key);
    await page.mouse.click(centre(b0).x, centre(b0).y);
    const handle = (await page.locator('#sel-box [data-corner="se"]').boundingBox())!;
    await drag(page, centre(handle), { x: centre(handle).x + b0.width * 0.5, y: centre(handle).y + b0.height * 0.5 });
    const b1 = await box(page, key);
    expect(b1.x).toBeCloseTo(b0.x, 0);
    expect(b1.y).toBeCloseTo(b0.y, 0);
    expect(b1.width / b0.width).toBeGreaterThan(1.35);
    await expect.poll(() => picked(page)).toEqual([key]);
  });

  test("Add symbols places exactly the drawing picked", async ({ page }) => {
    await open(page);
    await editMode(page);
    await page.locator("#add-open").click();
    await page.locator("#pal-grid .pal-item").nth(2).click();
    const map = (await page.locator("#map").boundingBox())!;
    for (const [dx, dy] of [[0.3, 0.3], [0.5, 0.4], [0.6, 0.6]]) await page.mouse.click(map.x + map.width * dx, map.y + map.height * dy);
    // Placed as a picture (data-drawing) or as a line drawing (href="#i-...").
    const drawings = await page.locator('#map [data-key^="add:"] :is(use, image)').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-drawing") ?? e.getAttribute("href")!.slice(3)))]);
    expect(drawings).toEqual(["mountain-3"]);
  });

  test("zoomed in, a drag on empty map pans and an item still follows the pointer", async ({ page }) => {
    await open(page);
    await editMode(page);
    await page.locator("#zoom-in").click();
    await page.locator("#zoom-in").click();
    await expect(page.locator("#zoom-level")).toHaveText("225%");
    const key = await isolatedItem(page);
    const b0 = await box(page, key);
    await drag(page, centre(b0), { x: centre(b0).x - 45, y: centre(b0).y + 35 });
    const b1 = await box(page, key);
    expect(b1.x - b0.x).toBeCloseTo(-45, 0);
    expect(b1.y - b0.y).toBeCloseTo(35, 0);
  });

  test("changes redraw only what they touch, quickly, and match a full redraw", async ({ page }) => {
    await open(page);
    await editMode(page);
    const key = await isolatedItem(page, "mountain");
    const c = centre(await box(page, key));
    await page.mouse.click(c.x, c.y);
    // Each of these is handled in a few frames at most, not a whole-map rebuild (150 ms+).
    const timed = (keyName: string, shift = false) =>
      page.evaluate(({ keyName, shift }) => {
        const t0 = performance.now();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, code: keyName === "]" ? "BracketRight" : keyName === "[" ? "BracketLeft" : "", shiftKey: shift, bubbles: true }));
        return performance.now() - t0;
      }, { keyName, shift });
    const times = [await timed("s"), await timed("]"), await timed("."), await timed("ArrowRight"), await timed("["), await timed(","), await timed("s")];
    // Judged by the typical change (the machine may be busy with other tests), with a
    // ceiling for the slowest.
    const sorted = [...times].sort((x, y) => x - y);
    expect(sorted[sorted.length >> 1]).toBeLessThan(60);
    expect(sorted[sorted.length - 1]).toBeLessThan(250);
    // Copy and paste somewhere, delete one pasted item, undo that, redo it.
    await page.keyboard.press("Control+c");
    await page.mouse.move(c.x + 90, c.y + 70);
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+y");
    await page.keyboard.press("Control+z");
    // The page as patched, item by item, must equal the same map drawn fresh from its link.
    // (Picture addresses differ on every page load, so they are left out of the comparison.)
    const snapshot = () =>
      page.evaluate(() => [...document.querySelectorAll<SVGElement>("#map [data-key]")].map((el) => el.outerHTML.replace(/ class="[^"]*"/, "").replace(/href="blob:[^"]*"/g, 'href="blob"')));
    const patched = await snapshot();
    await page.goto(page.url());
    await page.waitForFunction(() => document.querySelectorAll("#map image").length > 100);
    const fresh = await snapshot();
    expect(patched.length).toBe(fresh.length);
    expect(patched).toEqual(fresh);
  });

  test("a town's name and banner move with it", async ({ page }) => {
    await open(page);
    await editMode(page);
    // The capital has a name and a banner.
    const town = await page.evaluate(() => {
      const el = document.querySelector<SVGElement>('#map [data-tier="capital"]')!;
      return el.dataset.key!;
    });
    const id = town.slice(5);
    const name = await page.evaluate((id) => document.querySelector<SVGElement>(`#map [data-label][data-kind="capital"]`)!.dataset.key!, id);
    const banner = await page.evaluate((id) => document.querySelector<SVGElement>(`#map [data-emblem="${id}"]`)?.dataset.key ?? null, id);
    const before = { town: await box(page, town), name: await box(page, name), banner: banner ? await box(page, banner) : null };
    const t = await box(page, town);
    await page.mouse.click(centre(t).x, centre(t).y);
    await expect.poll(() => picked(page)).toEqual([town]);
    await drag(page, centre(t), { x: centre(t).x + 35, y: centre(t).y - 25 });
    for (const [key, b0] of [[town, before.town], [name, before.name], ...(banner ? [[banner, before.banner!]] : [])] as [string, Box][]) {
      const b1 = await box(page, key);
      expect(b1.x - b0.x, key).toBeCloseTo(35, 0);
      expect(b1.y - b0.y, key).toBeCloseTo(-25, 0);
    }
  });

  test("a new map has a title box and compass that can be moved and the title renamed", async ({ page }) => {
    await open(page, "/?map=3.acm9.p.35.50.60.5");
    await editMode(page);
    const title = await page.evaluate(() => document.querySelector<SVGElement>('#map [data-kind="title"]')!.dataset.key!);
    await expect(page.locator('#map [data-kind="compass"]')).toHaveCount(1);
    const b0 = await box(page, title);
    await page.mouse.click(centre(b0).x, centre(b0).y);
    await expect(page.locator("#rename")).toBeVisible();
    await page.locator("#label-text").fill("The Isles of Wonder");
    await page.locator("#label-text").press("Enter");
    await expect(item(page, title)).toContainText("THE ISLES OF WONDER");
    const b1 = await box(page, title);
    await drag(page, centre(b1), { x: centre(b1).x + 30, y: centre(b1).y - 40 });
    const b2 = await box(page, title);
    expect(b2.x - b1.x).toBeCloseTo(30, 0);
  });

  test("a town placed from the palette gets a name that can be changed", async ({ page }) => {
    await open(page);
    await editMode(page);
    await page.locator("#add-open").click();
    await page.locator("#pal-role").selectOption("town");
    await page.locator("#pal-grid .pal-item").first().click();
    const map = (await page.locator("#map").boundingBox())!;
    await page.mouse.click(map.x + map.width * 0.5, map.y + map.height * 0.45);
    const town = page.locator('#map [data-key^="add:"]');
    await expect(town.locator("text")).toHaveCount(1);
    const name = await town.locator("text").textContent();
    expect(name!.length).toBeGreaterThan(2);
    await page.locator("#pal-done").click();
    await expect(page.locator("#label-text")).toHaveValue(name!);
    await page.locator("#label-text").fill("Dragonford");
    await page.locator("#label-text").press("Enter");
    await expect(town.locator("text")).toHaveText("Dragonford");
  });

  test("the border choice restyles the frame without making a new map", async ({ page }) => {
    await open(page, "/?map=4.acm9.p.35.50.60.5");
    await editMode(page);
    // Make an edit first: it must survive the change of border.
    const key = await isolatedItem(page, "mountain");
    await page.mouse.click(centre(await box(page, key)).x, centre(await box(page, key)).y);
    await page.keyboard.press("Delete");
    const caption = await page.locator("#caption").textContent();
    await page.locator("#border").selectOption("chequered");
    await expect(page).toHaveURL(/map=4.acm9.p.35.50.60.5.k/);
    await expect(page).toHaveURL(/&e=/);
    await expect(item(page, key)).toHaveCount(0);
    expect(await page.locator("#caption").textContent()).toBe(caption); // not generated again
    await page.goto(page.url());
    await expect(page.locator("#border")).toHaveValue("chequered");
  });

  test("suggests other wordings for the title", async ({ page }) => {
    await open(page, "/?map=4.acm9.p.35.50.60.5");
    await editMode(page);
    const title = await page.evaluate(() => document.querySelector<SVGElement>('#map [data-kind="title"]')!.dataset.key!);
    const b = await box(page, title);
    await page.mouse.click(centre(b).x, centre(b).y);
    const first = await page.locator("#label-text").inputValue();
    await page.locator("#suggest").click();
    await expect(page.locator("#label-text")).not.toHaveValue(first);
    const second = await page.locator("#label-text").inputValue();
    expect(second).toContain("Svalholm");
    await expect(item(page, title)).toContainText(second.toUpperCase());
  });

  test("offers every kind in the library, loading a kind's drawings only when it is used", async ({ page }) => {
    const fetched: string[] = [];
    page.on("request", (r) => r.url().includes("/api/packs/") && fetched.push(r.url().split("/").pop()!));
    await open(page);
    expect(fetched).not.toContain("sea-monsters-v1.json"); // not needed to draw the map
    await editMode(page);
    await page.locator("#add-open").click();
    await page.locator("#pal-role").selectOption("sea-monsters");
    await expect(page.locator("#pal-grid .pal-item")).toHaveCount(4);
    expect(fetched).toContain("sea-monsters-v1.json");
    await page.locator("#pal-grid .pal-item").first().click();
    const map = (await page.locator("#map").boundingBox())!;
    await page.mouse.click(map.x + map.width * 0.3, map.y + map.height * 0.2);
    await expect(page.locator('#map [data-role="sea-monsters"]')).toHaveCount(1);
    await expect(page).toHaveURL(/&e=/); // the link is updated just after the change
    // Opening the link elsewhere loads that kind for the map straight away.
    fetched.length = 0;
    await page.goto(page.url());
    await page.waitForFunction(() => document.querySelectorAll('#map [data-role="sea-monsters"] :is(use, image)').length > 0);
    expect(fetched).toContain("sea-monsters-v1.json");
  });

  test("shows pre-drawn pictures of the drawings, and line drawings when zoomed in close", async ({ page }) => {
    await open(page);
    expect(await page.locator("#map use").count()).toBe(0);
    for (let i = 0; i < 3; i++) await page.locator("#zoom-in").click(); // 338%
    await page.waitForFunction(() => document.querySelectorAll("#map use").length > 100);
    expect(await page.locator("#map image").count()).toBe(0);
    await page.locator("#zoom-fit").click();
    await page.waitForFunction(() => document.querySelectorAll("#map image").length > 100);
  });

  test("the sea options redraw the sea without making a new map, and go into the link", async ({ page }) => {
    await open(page, "/?map=6.acm9.p.35.50.60.5");
    const caption = await page.locator("#caption").textContent();
    const paths = () => page.evaluate(() => document.querySelector("#map svg")!.innerHTML.length);
    const before = await paths();
    await page.locator("#compass-lines").check();
    await page.locator("#shallows").check();
    await page.locator("#deltas").check();
    await expect(page).toHaveURL(/map=6.acm9.p.35.50.60.5.clhd/);
    expect(await paths()).toBeGreaterThan(before);
    expect(await page.locator("#caption").textContent()).toBe(caption); // not made again
    await page.locator("#compass-lines").uncheck();
    await expect(page).toHaveURL(/.chd/);
  });

  test("saves SVG and PNG files", async ({ page }) => {
    await open(page);
    await page.locator('[popovertarget="export-pop"]').click(); // the Download menu in the top bar
    const [svg] = await Promise.all([page.waitForEvent("download"), page.locator("#export-svg").click()]);
    expect(svg.suggestedFilename()).toBe("ink-map-482913.svg");
    const text = await (await svg.createReadStream()).toArray();
    expect(Buffer.concat(text).toString("utf8")).toContain("@font-face");
    expect(Buffer.concat(text).toString("utf8")).not.toContain("blob:"); // line drawings, not the screen's pictures
    const [png] = await Promise.all([page.waitForEvent("download"), page.locator("#export-png").click()]);
    expect(png.suggestedFilename()).toBe("ink-map-482913.png");
  });
});
