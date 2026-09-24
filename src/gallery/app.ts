// Gallery page: "My maps" (saved in this browser) and "Everyone's maps" (the public
// gallery). Each card opens the map on the map page through its share link.

import { linkFor, loadMyMaps, removeMyMap } from "../app/mymaps";

interface PublicMap {
  id: string;
  name: string;
  code: string;
  edits: string;
  created: string;
}

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const tabs = { mine: $<HTMLButtonElement>("#tab-mine"), everyone: $<HTMLButtonElement>("#tab-everyone") };
const panels = { mine: $<HTMLElement>("#panel-mine"), everyone: $<HTMLElement>("#panel-everyone") };
const els = {
  mine: $<HTMLUListElement>("#mine"),
  mineEmpty: $<HTMLElement>("#mine-empty"),
  everyone: $<HTMLUListElement>("#everyone"),
  status: $<HTMLElement>("#everyone-status"),
  more: $<HTMLButtonElement>("#more"),
};

type Tab = keyof typeof tabs;
let next: string | null = null;
let loadedEveryone = false;

// Tabs, remembered in the address (#mine or #everyone) so the links from the map page land
// on the right one. Arrow keys move between tabs, as screen reader users expect.
function show(tab: Tab, focus = false) {
  for (const t of Object.keys(tabs) as Tab[]) {
    const on = t === tab;
    tabs[t].setAttribute("aria-selected", String(on));
    tabs[t].tabIndex = on ? 0 : -1;
    panels[t].hidden = !on;
  }
  if (focus) tabs[tab].focus();
  history.replaceState(null, "", `#${tab}`);
  if (tab === "everyone" && !loadedEveryone) void loadEveryone();
}
for (const t of Object.keys(tabs) as Tab[]) {
  tabs[t].addEventListener("click", () => show(t));
  tabs[t].addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") show(t === "mine" ? "everyone" : "mine", true);
  });
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function card(m: { name: string; code: string; edits: string }, thumb: string, when: string): { li: HTMLLIElement; actions: HTMLElement } {
  const li = document.createElement("li");
  li.className = "card";
  const href = linkFor(m);
  const pic = document.createElement("a");
  pic.className = "pic";
  pic.href = href;
  pic.tabIndex = -1; // the title link below is the one keyboard users need
  const img = document.createElement("img");
  img.src = thumb;
  img.alt = "";
  img.loading = "lazy";
  pic.append(img);
  const body = document.createElement("div");
  body.className = "body";
  const h2 = document.createElement("h2");
  const a = document.createElement("a");
  a.href = href;
  a.textContent = m.name;
  h2.append(a);
  const time = document.createElement("time");
  time.dateTime = when;
  time.textContent = dateText(when);
  const actions = document.createElement("div");
  actions.className = "actions";
  body.append(h2, time, actions);
  li.append(pic, body);
  return { li, actions };
}

function renderMine() {
  const list = loadMyMaps();
  els.mine.replaceChildren();
  els.mineEmpty.hidden = list.length > 0;
  for (const m of list) {
    const { li, actions } = card(m, m.thumb, m.saved);
    // Two presses to remove, so a slip does not lose a map.
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "plain";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${m.name}`);
    remove.addEventListener("click", () => {
      if (remove.dataset.sure !== "1") {
        remove.dataset.sure = "1";
        remove.textContent = "Sure? Remove";
        return;
      }
      removeMyMap(m.id);
      renderMine();
      els.mine.querySelector<HTMLElement>("h2 a")?.focus();
    });
    actions.append(remove);
    els.mine.append(li);
  }
}

async function loadEveryone() {
  loadedEveryone = true;
  els.more.hidden = true;
  els.status.textContent = "Loading maps...";
  try {
    const res = await fetch(`/api/gallery${next ? `?before=${encodeURIComponent(next)}` : ""}`);
    if (!res.ok) throw new Error(`the server said ${res.status}`);
    const page = (await res.json()) as { maps: PublicMap[]; next: string | null };
    for (const m of page.maps) els.everyone.append(card(m, `/api/gallery/${m.id}.jpg`, m.created).li);
    next = page.next;
    els.more.hidden = !next;
    els.status.textContent = els.everyone.children.length ? "" : "Nobody has published a map yet. Be the first: make one and press \"Publish\".";
  } catch (err) {
    loadedEveryone = false;
    els.status.textContent = `The gallery did not load (${(err as Error).message}). Try again in a moment.`;
  }
}
els.more.addEventListener("click", () => void loadEveryone());

renderMine();
show(location.hash === "#everyone" ? "everyone" : "mine");
// Another tab may save a map while this page is open.
addEventListener("storage", renderMine);
