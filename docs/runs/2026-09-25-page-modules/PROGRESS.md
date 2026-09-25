# Run progress: split the map page code into modules

Goal: split `src/app/main.ts` into focused modules with no change in behaviour, checked by
the type checker, the unit tests and the browser tests after every step (see PLAN.md).

## 2026-09-25: step 1, baseline (done)

Run in the interactive session at Steven's request ("Do the tidy up").

- `npm run typecheck`: exit 0.
- `npm test`: 200 unit tests and 28 API tests passed.
- `npm run e2e` (all browsers): 80 passed, 45 skipped (by design: mouse-only tests on the
  phone and tablet, and so on), 0 failed, in 14.1 minutes.
- `public/app.js`: 108,592 bytes.

## 2026-09-25: steps 2 to 8b (done, committed together)

The baseline browser run served the built page for 14 minutes, so steps 2 to 8b were made
one at a time with the type checker after each, then checked and committed together once
it finished. Done conditions, all met:

- Step 2, `src/app/dom.ts` (`$`, `els`): `querySelector<T>` in main.ts: 0.
- Step 3, `src/app/state.ts` (one `state` object, plus the `Hit` and `Moving` types, and
  `confirmPublish`, which a new map resets): `^let ` lines in main.ts: 3.
- Step 4, `src/app/history.ts` (`initHistory` for Undo and Redo): `function patchItems`: 1.
- Step 5, `src/app/selection.ts` (also `primary`; the `window.inkMap` test hook is set when
  the module loads, as before): `inkMap`: 1.
- Step 6, `src/app/gestures.ts` (`initGestures`, also the zoom buttons):
  `addEventListener("pointerdown"` in main.ts: 0.
- Step 7, `src/app/keys.ts`, `clipboard.ts`, `resize.ts`: all exist.
- Step 8, `src/app/palette.ts` (with `settlementName`) and `actions.ts`: both exist.
- Step 8b, `src/app/ink.ts`: `function loadKinds`: 1.

Checks: `npm run typecheck` exit 0; `npm test` 200 and 28 passed; `npm run build`, then
`npx playwright test --project=chromium` 23 passed, 2 skipped. `public/app.js` is 111,484
bytes (2.7% over the baseline: `state.` property names are not shortened by the minifier).
main.ts is now 413 lines.

## 2026-09-25: step 9, panels (done)

`src/app/panels.ts`: SVG and PNG export, the share link (`updateLink`, Copy link), Save to
My maps and Publish, registered by `initPanels`. The messages about a link's unreadable
edits or newer version stay in main.ts with the rest of the startup. Checks: typecheck
exit 0; unit tests 200 and 28 passed; Chromium 23 passed, 2 skipped. `updateLink` in
panels.ts: 1. main.ts is 299 lines.

## 2026-09-25: step 10, what is left in main.ts (done)

main.ts now holds the startup (reading the link, and its two warnings), the settings form
(including Border, Coast and the Sea group), `draw`, `paint`, `svgFor`, `seaStyle`, the
relief overlay, `applyView` and `previewView`, and one block calling the `init...()`
functions in the order the listeners were registered before. Unused imports removed; a
comment at the top lists the modules. Checks: typecheck exit 0; unit tests 200 and 28
passed; Chromium 23 passed, 2 skipped. `wc -l < src/app/main.ts`: 306 (target under 500).

## 2026-09-25: step 11, full check (done)

- `npm run typecheck`: exit 0.
- `npm test`: 200 unit tests and 28 API tests passed.
- `npm run e2e` (all browsers): 80 passed, 45 skipped, 0 failed, in 12.1 minutes (the same
  counts as the baseline).
- `public/app.js`: 111,503 bytes, 2.7% over the baseline of 108,592 (limit 5%).
- README.md has a "Page code" section listing the `src/app/` modules.

Not deployed, as the plan says: Steven reviews and deploys.
