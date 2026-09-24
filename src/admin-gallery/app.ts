// Gallery review page (admin, behind Access): every published map with Hide or Show and
// Delete. Hiding takes a map off the public gallery at once and can be undone; deleting
// removes the entry and its picture for good, so it asks twice.

import { linkFor } from "../app/mymaps";

interface Entry {
  id: string;
  name: string;
  code: string;
  edits: string;
  created: string;
  hidden: number;
}

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const els = { status: $<HTMLElement>("#status"), list: $<HTMLUListElement>("#maps"), onlyHidden: $<HTMLInputElement>("#only-hidden") };
let maps: Entry[] = [];

async function load() {
  els.status.textContent = "Loading...";
  const res = await fetch("/api/import/gallery");
  if (!res.ok) {
    els.status.textContent = `Could not load the gallery (${res.status}). Signed in?`;
    return;
  }
  maps = ((await res.json()) as { maps: Entry[] }).maps;
  render();
}

function render() {
  const shown = els.onlyHidden.checked ? maps.filter((m) => m.hidden) : maps;
  const hidden = maps.filter((m) => m.hidden).length;
  els.status.textContent = `${maps.length} published ${maps.length === 1 ? "map" : "maps"}, ${hidden} hidden.`;
  els.list.replaceChildren(...shown.map(item));
}

function button(text: string, onClick: (b: HTMLButtonElement) => void, danger = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (danger) b.className = "danger";
  b.addEventListener("click", () => onClick(b));
  return b;
}

function item(m: Entry): HTMLLIElement {
  const li = document.createElement("li");
  if (m.hidden) li.className = "hidden-map";
  const img = document.createElement("img");
  img.src = `/api/import/gallery/${m.id}.jpg`;
  img.alt = "";
  img.loading = "lazy";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = m.name;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `${new Date(m.created).toLocaleString()} · ${m.hidden ? "hidden" : "public"} · ${m.edits ? "edited" : "as generated"}`;
  const open = document.createElement("a");
  open.className = "open";
  open.href = linkFor(m);
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = "Open";
  const toggle = button(m.hidden ? "Show" : "Hide", async (b) => {
    b.disabled = true;
    const res = await fetch(`/api/import/gallery/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hidden: !m.hidden }) });
    if (res.ok) m.hidden = m.hidden ? 0 : 1;
    else els.status.textContent = `Could not change "${m.name}" (${res.status}).`;
    render();
  });
  const del = button(
    "Delete",
    async (b) => {
      if (b.dataset.sure !== "1") {
        b.dataset.sure = "1";
        b.textContent = "Sure? Delete for good";
        return;
      }
      b.disabled = true;
      const res = await fetch(`/api/import/gallery/${m.id}`, { method: "DELETE" });
      if (res.ok) maps = maps.filter((x) => x.id !== m.id);
      else els.status.textContent = `Could not delete "${m.name}" (${res.status}).`;
      render();
    },
    true,
  );
  const row = document.createElement("div");
  row.className = "acts";
  row.append(open, toggle, del);
  li.append(img, name, meta, row);
  return li;
}

els.onlyHidden.addEventListener("change", render);
void load();
