// The panels beside the map: saving SVG and PNG files, the share link, and keeping a map in
// My maps or the public gallery.

import type { EditedMap } from "../gen/edits";
import { els } from "./dom";
import { embeddedFontCss, pngSize, saveBlob, svgToPng, svgToThumb, toBase64 } from "./export";
import { svgFor } from "./main";
import { saveMyMap } from "./mymaps";
import { encodeEdits, encodeSettings } from "./share";
import { state } from "./state";

export function initPanels() {
  els.exportSvg.addEventListener("click", () =>
    exporting("Saving the SVG", async (map) => {
      const svg = svgFor(map, await embeddedFontCss());
      saveBlob(new Blob([svg], { type: "image/svg+xml" }), `ink-map-${map.settings.seed}.svg`);
    }),
  );

  for (const [button, kind] of [[els.exportPng, "screen"], [els.exportA3, "a3"]] as const) {
    button.addEventListener("click", () =>
      exporting(kind === "a3" ? "Drawing the A3 print PNG" : "Drawing the PNG", async (map) => {
        const [w, h] = pngSize(kind, map.settings.width, map.settings.height);
        const png = await svgToPng(svgFor(map, await embeddedFontCss()), w, h);
        saveBlob(png, `ink-map-${map.settings.seed}${kind === "a3" ? "-a3" : ""}.png`);
      }),
    );
  }

  els.copyLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(els.shareLink.value);
      els.shareStatus.value = "Link copied.";
    } catch {
      // Clipboard access can be refused; leave the link selected to copy by hand.
      els.shareLink.select();
      els.shareStatus.value = "Press Ctrl+C (or Cmd+C) to copy the selected link.";
    }
  });

  els.shareLink.addEventListener("focus", () => els.shareLink.select());

  els.saveMine.addEventListener("click", () => keepMap("mine"));

  els.publish.addEventListener("click", () => {
    // Publishing is public, so the first press explains and the second one publishes.
    if (!state.confirmPublish) {
      state.confirmPublish = true;
      els.publish.textContent = "Yes, publish it";
      els.keepStatus.textContent = "This shows the map, its name and a small picture to everyone who visits the gallery. Press again to publish.";
      return;
    }
    state.confirmPublish = false;
    els.publish.textContent = "Publish to the public gallery";
    void keepMap("public");
  });
}

export async function exporting(what: string, job: (map: EditedMap) => Promise<void>) {
  if (!state.edited) return;
  const buttons = [els.exportSvg, els.exportPng, els.exportA3];
  buttons.forEach((b) => (b.disabled = true));
  els.exportStatus.value = `${what}...`;
  try {
    await job(state.edited);
    els.exportStatus.value = "Saved.";
  } catch (err) {
    console.error(err);
    els.exportStatus.value = `Sorry, that did not work: ${(err as Error).message}`;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ---- Share link ----
// The address bar always holds the current map's link, so copying the address shares it too.

// Links are rebuilt after every change; a newer rebuild wins if two overlap.
let linkRun = 0;
export async function updateLink() {
  if (!state.current) return;
  const run = ++linkRun;
  const e = await encodeEdits(state.edits);
  if (run !== linkRun) return;
  const url = new URL(location.href);
  url.search = `?map=${encodeSettings(state.current.settings)}${e ? `&e=${e}` : ""}`;
  url.hash = "";
  history.replaceState(null, "", url);
  els.shareLink.value = url.href;
}

// ---- My maps and the public gallery ----

export async function keepMap(where: "mine" | "public") {
  if (!state.edited || !state.current) return;
  const map = state.edited;
  const name = (els.mapName.value.trim() || els.mapName.placeholder).slice(0, 60);
  const buttons = [els.saveMine, els.publish];
  buttons.forEach((b) => (b.disabled = true));
  els.keepStatus.textContent = "Drawing a small picture of the map...";
  try {
    const { width, height } = map.settings;
    const thumb = new Uint8Array(await (await svgToThumb(svgFor(map, await embeddedFontCss()), width, height)).arrayBuffer());
    const code = encodeSettings(map.settings);
    const e = await encodeEdits(state.edits);
    if (where === "mine") {
      saveMyMap({ name, code, edits: e, thumb: `data:image/jpeg;base64,${toBase64(thumb)}` });
      showKept(`Saved "${name}" to My maps. `, "/gallery/#mine", "See My maps");
    } else {
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, edits: e, thumb: toBase64(thumb) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `the server said ${res.status}`);
      showKept(`Published "${name}". `, "/gallery/#everyone", "See the gallery");
    }
  } catch (err) {
    els.keepStatus.textContent = `Sorry, that did not work: ${(err as Error).message}`;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

export function showKept(text: string, href: string, linkText: string) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = linkText;
  els.keepStatus.replaceChildren(text, a);
}
