// "My maps": maps saved in this browser only (nothing leaves the device). Each is its share
// link parts, a name and a small thumbnail, kept in the browser's local storage.

export interface SavedMap {
  id: string;
  name: string;
  code: string; // settings share code
  edits: string; // edits part of the link, may be empty
  thumb: string; // JPEG thumbnail as a data URL
  saved: string; // ISO date and time
}

const KEY = "ink-maps.my-maps.v1";

export function linkFor(m: { code: string; edits: string }): string {
  return `/?map=${m.code}${m.edits ? `&e=${m.edits}` : ""}`;
}

export function loadMyMaps(): SavedMap[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((m) => m && typeof m.code === "string" && typeof m.name === "string") : [];
  } catch {
    return []; // storage blocked (private window) or damaged: start empty
  }
}

function store(list: SavedMap[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (err) {
    throw new Error((err as Error).name === "QuotaExceededError" ? "This browser's storage is full. Remove a few saved maps and try again." : "This browser is not letting the page save anything (a private window, perhaps).");
  }
}

// Save a map, newest first. Saving the same map with the same edits again updates it.
export function saveMyMap(entry: Omit<SavedMap, "id" | "saved">): SavedMap {
  const list = loadMyMaps();
  const same = list.find((m) => m.code === entry.code && m.edits === entry.edits);
  const saved: SavedMap = { ...entry, id: same?.id ?? crypto.randomUUID().slice(0, 12), saved: new Date().toISOString() };
  store([saved, ...list.filter((m) => m.id !== saved.id)]);
  return saved;
}

export function removeMyMap(id: string) {
  store(loadMyMaps().filter((m) => m.id !== id));
}
