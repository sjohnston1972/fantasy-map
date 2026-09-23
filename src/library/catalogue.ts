// Library listing helpers: group catalogue rows by category and filter them. Pure logic,
// so it is tested without a browser.

export interface CatalogueIcon {
  id: string;
  sheet_id: string;
  row_index: number;
  col_index: number;
  category: string;
  subtype: string | null;
  scales: string; // comma-separated, as stored in D1
  kind: string;
  facing: string;
  width_px: number;
  height_px: number;
  anchor_x: number;
  anchor_y: number;
  status: string;
  png_key: string;
  svg_key: string | null;
  created: string;
  updated: string;
}

export interface Filters {
  status: string; // approved | rejected | draft | all
  category: string | null; // null means every category
  scale: string | null;
  kind: string | null;
  text: string; // matches id, category or subtype
}

export const DEFAULT_FILTERS: Filters = { status: "approved", category: null, scale: null, kind: null, text: "" };

export function scalesOf(icon: CatalogueIcon): string[] {
  return icon.scales.split(",").filter(Boolean);
}

// Everything except the category filter, so the category list can show how many icons
// each category would give with the other filters applied.
function matchesOthers(icon: CatalogueIcon, f: Filters): boolean {
  if (f.status !== "all" && icon.status !== f.status) return false;
  if (f.scale && !scalesOf(icon).includes(f.scale)) return false;
  if (f.kind && icon.kind !== f.kind) return false;
  const t = f.text.trim().toLowerCase();
  if (t && !`${icon.id} ${icon.category} ${icon.subtype ?? ""}`.toLowerCase().includes(t)) return false;
  return true;
}

export function filterIcons(icons: CatalogueIcon[], f: Filters): CatalogueIcon[] {
  return icons.filter((i) => matchesOthers(i, f) && (f.category === null || i.category === f.category));
}

// Categories in alphabetical order with how many icons each has under the other filters.
export function categoryCounts(icons: CatalogueIcon[], f: Filters): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of icons) {
    if (!counts.has(i.category)) counts.set(i.category, 0);
    if (matchesOthers(i, f)) counts.set(i.category, counts.get(i.category)! + 1);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category));
}

// Icons grouped by category (then subtype), in a stable order for display.
export function groupByCategory(icons: CatalogueIcon[]): { category: string; icons: CatalogueIcon[] }[] {
  const groups = new Map<string, CatalogueIcon[]>();
  for (const i of icons) {
    if (!groups.has(i.category)) groups.set(i.category, []);
    groups.get(i.category)!.push(i);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({
      category,
      icons: list.sort(
        (a, b) =>
          (a.subtype ?? "").localeCompare(b.subtype ?? "") ||
          a.sheet_id.localeCompare(b.sheet_id) ||
          a.row_index - b.row_index ||
          a.col_index - b.col_index,
      ),
    }));
}

// The filters as a short query string, so a filtered view can be bookmarked or shared.
export function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.status !== DEFAULT_FILTERS.status) p.set("status", f.status);
  if (f.category) p.set("category", f.category);
  if (f.scale) p.set("scale", f.scale);
  if (f.kind) p.set("kind", f.kind);
  if (f.text) p.set("q", f.text);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function filtersFromQuery(query: string): Filters {
  const p = new URLSearchParams(query);
  const status = p.get("status") ?? DEFAULT_FILTERS.status;
  return {
    status: ["approved", "rejected", "draft", "all"].includes(status) ? status : DEFAULT_FILTERS.status,
    category: p.get("category"),
    scale: p.get("scale"),
    kind: p.get("kind"),
    text: p.get("q") ?? "",
  };
}
