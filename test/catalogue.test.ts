import { describe, expect, it } from "vitest";
import {
  categoryCounts,
  DEFAULT_FILTERS,
  filterIcons,
  filtersFromQuery,
  filtersToQuery,
  groupByCategory,
  type CatalogueIcon,
} from "../src/library/catalogue";

let n = 0;
const icon = (p: Partial<CatalogueIcon>): CatalogueIcon => ({
  id: `0123456789abcdef-r1-c${++n}`,
  sheet_id: "0123456789abcdef",
  row_index: 1,
  col_index: n,
  category: "cacti",
  subtype: null,
  scales: "region",
  kind: "point",
  facing: "none",
  width_px: 100,
  height_px: 100,
  anchor_x: 0.5,
  anchor_y: 1,
  status: "approved",
  png_key: "",
  svg_key: "",
  created: "",
  updated: "",
  ...p,
});

const icons = [
  icon({ category: "cacti", subtype: "saguaro" }),
  icon({ category: "cacti", subtype: "barrel", scales: "region,world" }),
  icon({ category: "sand dunes", kind: "pattern" }),
  icon({ category: "ruins", status: "rejected" }),
  icon({ category: "oases", status: "draft", scales: "world" }),
];

describe("library filters", () => {
  it("shows approved icons by default", () => {
    expect(filterIcons(icons, DEFAULT_FILTERS).map((i) => i.category)).toEqual(["cacti", "cacti", "sand dunes"]);
  });

  it("filters by category, scale, kind and text", () => {
    expect(filterIcons(icons, { ...DEFAULT_FILTERS, category: "cacti" })).toHaveLength(2);
    expect(filterIcons(icons, { ...DEFAULT_FILTERS, scale: "world" }).map((i) => i.subtype)).toEqual(["barrel"]);
    expect(filterIcons(icons, { ...DEFAULT_FILTERS, kind: "pattern" }).map((i) => i.category)).toEqual(["sand dunes"]);
    expect(filterIcons(icons, { ...DEFAULT_FILTERS, text: "SAGU" }).map((i) => i.subtype)).toEqual(["saguaro"]);
  });

  it("can show rejected, draft or every icon", () => {
    expect(filterIcons(icons, { ...DEFAULT_FILTERS, status: "rejected" }).map((i) => i.category)).toEqual(["ruins"]);
    expect(filterIcons(icons, { ...DEFAULT_FILTERS, status: "all" })).toHaveLength(5);
  });

  it("counts each category under the other filters, keeping empty ones listed", () => {
    expect(categoryCounts(icons, DEFAULT_FILTERS)).toEqual([
      { category: "cacti", count: 2 },
      { category: "oases", count: 0 },
      { category: "ruins", count: 0 },
      { category: "sand dunes", count: 1 },
    ]);
    // Choosing a category does not change the counts of the others.
    expect(categoryCounts(icons, { ...DEFAULT_FILTERS, category: "cacti" })).toEqual(categoryCounts(icons, DEFAULT_FILTERS));
  });

  it("groups by category, then by subtype", () => {
    const groups = groupByCategory(filterIcons(icons, DEFAULT_FILTERS));
    expect(groups.map((g) => g.category)).toEqual(["cacti", "sand dunes"]);
    expect(groups[0].icons.map((i) => i.subtype)).toEqual(["barrel", "saguaro"]);
  });

  it("round-trips filters through the address bar", () => {
    const f = { status: "all", category: "sand dunes", scale: "world", kind: "pattern", text: "dune" };
    expect(filtersFromQuery(filtersToQuery(f))).toEqual(f);
    expect(filtersToQuery(DEFAULT_FILTERS)).toBe("");
    expect(filtersFromQuery("?status=bogus").status).toBe("approved");
  });
});
