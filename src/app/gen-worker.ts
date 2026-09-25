// Makes maps in a background thread (see maker.ts), so the page stays responsive while the
// generator runs. A map is plain data, so it copies back to the page unchanged.

import { generate } from "../gen/pipeline";
import type { MapSettings } from "../gen/settings";

const scope = self as unknown as { onmessage: (e: MessageEvent<MapSettings>) => void; postMessage(message: unknown): void };
scope.onmessage = (e) => scope.postMessage(generate(e.data));
