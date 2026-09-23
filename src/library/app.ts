// Library page (sheet import milestone 6): browse the icons in the catalogue by category.
// Reads GET /api/import/icons and the stored files; changes nothing.

import {
  categoryCounts,
  DEFAULT_FILTERS,
  filterIcons,
  filtersFromQuery,
  filtersToQuery,
  groupByCategory,
  scalesOf,
  type CatalogueIcon,
  type Filters,
} from "./catalogue";

const LIMIT = 1000; // the API returns at most this many rows

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const els = {
  status: $<HTMLElement>("#status"),
  categories: $<HTMLUListElement>("#categories"),
  grid: $<HTMLElement>("#grid"),
  detail: $<HTMLElement>("#detail"),
  text: $<HTMLInputElement>("#f-text"),
  state: $<HTMLSelectElement>("#f-status"),
  scale: $<HTMLSelectElement>("#f-scale"),
  kind: $<HTMLSelectElement>("#f-kind"),
  count: $<HTMLElement>("#count"),
  size: $<HTMLInputElement>("#f-size"),
};

let icons: CatalogueIcon[] = [];
let filters: Filters = filtersFromQuery(location.search);
let selected: string | null = null;

syncControls();
els.text.addEventListener("input", () => update({ text: els.text.value }));
els.state.addEventListener("change", () => update({ status: els.state.value }));
els.scale.addEventListener("change", () => update({ scale: els.scale.value || null }));
els.kind.addEventListener("change", () => update({ kind: els.kind.value || null }));
els.size.addEventListener("input", () => document.documentElement.style.setProperty("--tile", `${els.size.value}px`));
$<HTMLFormElement>(".filters").addEventListener("submit", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selected) select(null);
});
void load();

async function load() {
  setStatus("Loading the library...");
  try {
    const res = await fetch("/api/import/icons", { credentials: "same-origin" });
    if (res.status === 401) throw new Error("Your sign-in has expired. Reload the page to sign in again.");
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    icons = ((await res.json()) as { icons: CatalogueIcon[] }).icons;
    const approved = icons.filter((i) => i.status === "approved").length;
    setStatus(
      icons.length
        ? `${approved} approved ${approved === 1 ? "icon" : "icons"} in ${new Set(icons.map((i) => i.category)).size} categories.` +
            (icons.length >= LIMIT ? ` Showing the first ${LIMIT} catalogue rows; narrow the filters to see others.` : "")
        : "",
    );
    render();
  } catch (err) {
    setStatus(`Could not load the library. ${err instanceof Error ? err.message : err}`);
  }
}

function update(patch: Partial<Filters>) {
  filters = { ...filters, ...patch };
  history.replaceState(null, "", `${location.pathname}${filtersToQuery(filters)}`);
  render();
}

function syncControls() {
  els.text.value = filters.text;
  els.state.value = filters.status;
  els.scale.value = filters.scale ?? "";
  els.kind.value = filters.kind ?? "";
}

function render() {
  drawCategories();
  drawGrid();
  drawDetail();
}

function drawCategories() {
  els.categories.replaceChildren();
  const counts = categoryCounts(icons, filters);
  const total = counts.reduce((n, c) => n + c.count, 0);
  els.categories.append(categoryItem(null, "All categories", total));
  for (const c of counts) els.categories.append(categoryItem(c.category, c.category, c.count));
}

function categoryItem(value: string | null, label: string, count: number) {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cat";
  b.setAttribute("aria-pressed", String(filters.category === value));
  if (!count && value !== null) b.classList.add("empty");
  const name = document.createElement("span");
  name.textContent = label;
  const n = document.createElement("span");
  n.className = "n";
  n.textContent = String(count);
  b.append(name, n);
  b.addEventListener("click", () => update({ category: filters.category === value ? null : value }));
  li.append(b);
  return li;
}

function drawGrid() {
  const shown = filterIcons(icons, filters);
  els.count.textContent = `${shown.length} ${shown.length === 1 ? "icon" : "icons"}`;
  els.grid.replaceChildren();
  if (!icons.length) {
    const p = document.createElement("div");
    p.className = "empty-state";
    p.innerHTML = `<p>The library is empty.</p><p>Approve icons on the <a href="../import/">Import page</a> and they appear here.</p>`;
    els.grid.append(p);
    return;
  }
  if (!shown.length) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "No icons match these filters.";
    els.grid.append(p);
    return;
  }
  for (const group of groupByCategory(shown)) {
    const sec = document.createElement("section");
    const h = document.createElement("h2");
    h.textContent = group.category;
    const count = document.createElement("span");
    count.className = "n";
    count.textContent = ` ${group.icons.length}`;
    h.append(count);
    const cards = document.createElement("div");
    cards.className = "cards";
    for (const icon of group.icons) cards.append(card(icon));
    sec.append(h, cards);
    els.grid.append(sec);
  }
}

function card(icon: CatalogueIcon) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `icon-card ${icon.status}${icon.id === selected ? " selected" : ""}`;
  b.dataset.id = icon.id;
  const frame = document.createElement("span");
  frame.className = "frame";
  const img = document.createElement("img");
  img.src = fileUrl(icon.svg_key ?? icon.png_key);
  img.alt = `${icon.category}${icon.subtype ? ", " + icon.subtype : ""}`;
  img.loading = "lazy";
  frame.append(img);
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = icon.subtype || icon.category;
  b.append(frame, label);
  if (icon.status !== "approved") {
    const tag = document.createElement("span");
    tag.className = "state";
    tag.textContent = icon.status;
    b.append(tag);
  }
  b.addEventListener("click", () => select(icon.id === selected ? null : icon.id));
  return b;
}

function select(id: string | null) {
  selected = id;
  els.grid.querySelectorAll(".icon-card.selected").forEach((c) => c.classList.remove("selected"));
  if (id) els.grid.querySelector(`[data-id="${id}"]`)?.classList.add("selected");
  drawDetail();
}

function drawDetail() {
  const icon = icons.find((i) => i.id === selected);
  els.detail.replaceChildren();
  if (!icon) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Click an icon to see it larger, with its tags and where it sits on the ground.";
    els.detail.append(p);
    return;
  }
  const h = document.createElement("h2");
  h.textContent = icon.subtype ? `${icon.category}: ${icon.subtype}` : icon.category;

  // The SVG with its anchor (where it meets the ground) marked, beside the PNG.
  const pair = document.createElement("div");
  pair.className = "pair";
  const sources: [string, string | null][] = [
    ["SVG", icon.svg_key],
    ["PNG", icon.png_key],
  ];
  for (const [label, key] of sources) {
    if (!key) continue;
    const fig = document.createElement("figure");
    const wrap = document.createElement("span");
    wrap.className = "anchor-wrap";
    const img = document.createElement("img");
    img.src = fileUrl(key);
    img.alt = `${label} of ${icon.id}`;
    const dot = document.createElement("i");
    dot.className = "anchor";
    dot.style.left = `${icon.anchor_x * 100}%`;
    dot.style.top = `${icon.anchor_y * 100}%`;
    dot.title = "Anchor: where the icon meets the ground";
    wrap.append(img, dot);
    const cap = document.createElement("figcaption");
    const a = document.createElement("a");
    a.href = fileUrl(key);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = `Open ${label}`;
    cap.append(a);
    fig.append(wrap, cap);
    pair.append(fig);
  }

  const dl = document.createElement("dl");
  const add = (k: string, v: string) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  };
  add("Status", icon.status);
  add("Category", icon.category);
  add("Subtype", icon.subtype || "none");
  add("Scales", scalesOf(icon).join(", "));
  add("Kind", icon.kind);
  add("Facing", icon.facing);
  add("Size", `${icon.width_px} by ${icon.height_px} px`);
  add("Anchor", `${icon.anchor_x.toFixed(2)}, ${icon.anchor_y.toFixed(2)}`);
  add("Sheet", `${icon.sheet_id}, row ${icon.row_index}, column ${icon.col_index}`);
  add("Saved", new Date(icon.updated).toLocaleString());
  const id = document.createElement("p");
  id.className = "icon-id";
  id.textContent = icon.id;
  els.detail.append(h, id, pair, dl);
}

function fileUrl(key: string): string {
  return `/api/import/files/${key}`;
}

function setStatus(text: string) {
  els.status.textContent = text;
}
