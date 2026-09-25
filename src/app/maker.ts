// Making maps without freezing the page: the generator runs in a background thread
// (gen-worker.ts), one map at a time. A map asked for while another is being made waits,
// and is replaced by any later request, so a burst of changes makes at most two maps and
// the last one always wins. Browsers that cannot start the thread make maps on the page.

import { generate, type GeneratedMap } from "../gen/pipeline";
import type { MapSettings } from "../gen/settings";

let worker: Worker | null | undefined; // undefined: not started yet; null: not available
let latest = 0;
let busy = false;
let waiting: { id: number; settings: MapSettings; done: (map: GeneratedMap | null) => void } | null = null;

// Make a map. Resolves to null if a later request replaced this one.
export function makeMap(settings: MapSettings): Promise<GeneratedMap | null> {
  const id = ++latest;
  return new Promise((done) => {
    waiting?.done(null);
    waiting = { id, settings, done };
    next();
  });
}

function next() {
  if (busy || !waiting) return;
  const job = waiting;
  waiting = null;
  busy = true;
  void run(job.settings).then((map) => {
    busy = false;
    job.done(job.id === latest ? map : null);
    next();
  });
}

function run(settings: MapSettings): Promise<GeneratedMap> {
  if (worker === undefined) {
    try {
      worker = new Worker("/gen-worker.js");
    } catch {
      worker = null;
    }
  }
  const w = worker;
  if (!w) return onPage(settings);
  return new Promise((resolve) => {
    w.onmessage = (e: MessageEvent<GeneratedMap>) => resolve(e.data);
    // If the thread fails (it could not load, say), make this map and later ones on the page.
    w.onerror = (e) => {
      e.preventDefault();
      console.warn("The background map maker failed; making maps on the page instead.", e.message);
      w.terminate();
      worker = null;
      void onPage(settings).then(resolve);
    };
    w.postMessage(settings);
  });
}

// On the page itself, after letting the browser draw anything already asked for.
function onPage(settings: MapSettings): Promise<GeneratedMap> {
  return new Promise((resolve) => setTimeout(() => resolve(generate(settings))));
}
