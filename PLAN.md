# Run plan: split the map page code into modules

**Goal.** `src/app/main.ts` (about 1,650 lines) holds the whole map page: generating and
drawing, zoom wiring, picking, dragging, box select, keyboard, clipboard, palette, resizing,
history, sharing, export and the gallery buttons. Split it into focused modules so future
changes are safer. **No behaviour changes**: the page must look and work exactly as before.

**Rules for this run**

- Move code; do not change what it does. No new features, no changes to any text the
  visitor sees, no changes to `src/gen/`, `src/api/`, `public/` or the tests' expectations.
- Keep the existing comments with the code they describe, and match the surrounding style
  (plain-English comments, no em-dashes anywhere).
- Shared mutable state lives in one exported object (see step 3), so modules never need to
  reassign each other's variables. Modules that register event listeners export an
  `init...()` function; `main.ts` calls them in the same order the listeners are
  registered today (order matters for the two `keydown` listeners and the pointer handlers).
- Import cycles between the new modules are fine only if no module *uses* another at load
  time (only inside functions). If a step creates a load-time cycle, restructure it.
- Checks after every step: `npm run typecheck`, `npm test`, and
  `npx playwright test --project=chromium` (run `npm run build` first; the browser tests
  need the built page). If a browser test fails, rerun it once; if it fails again, undo the
  step (`git checkout -- .`), note it under Blockers in PROGRESS.md, and stop the run.
- Commit after each step with a clear message ending in the session line used in this repo,
  and `git push`. **Do not deploy** (`wrangler deploy`): Steven reviews and deploys.

## Steps

1. **Baseline.** Run `npm run typecheck`, `npm test` and `npm run e2e` (all browsers).
   Record the test counts and the size of `public/app.js` in PROGRESS.md.
   *Done when:* all three exit with code 0.

2. **DOM lookups → `src/app/dom.ts`.** Move `$` and the `els` table there, exported;
   `main.ts` imports them.
   *Done when:* the step checks pass and `grep -c 'querySelector<T>' src/app/main.ts` is 0.

3. **Shared state → `src/app/state.ts`.** One exported `state` object holding what the
   modules share: `settings`, `current`, `ink`, `edits`, `edited`, `undoStack`,
   `redoStack`, `picked`, `editing`, `placing`, `hitList`, `drag`, `box`, `resizing`,
   `areaMode`, `clipboard`, `lastPointer`, `linkEdits`, `manifest`, `loading`, `sprites`,
   `spritesShown`, and the `zoom` instance. Replace the
   module-level `let`s in `main.ts` with `state.<name>`.
   *Done when:* the step checks pass and `grep -cE '^let ' src/app/main.ts` is at most 3.

4. **History → `src/app/history.ts`.** `commit`, `switchTo`, `patchItems`, `undo`, `redo`,
   `commitShown`, `movePicked`, `forPicked`, `followers`.
   *Done when:* the step checks pass and `grep -c 'function patchItems' src/app/history.ts`
   is 1.

5. **Picking and the selection box → `src/app/selection.ts`.** `hits`, `screenBox`,
   `keysIn`, `pickAt`, the `window.inkMap` test hook, `select`, `togglePick`,
   `showSelection`, `pickedRect`, `placeSelBox`, `itemEl`, `anchorOf`, `screenToMap`.
   *Done when:* the step checks pass and `grep -c 'inkMap' src/app/selection.ts` is at
   least 1.

6. **Pointer gestures → `src/app/gestures.ts`.** The map's pointerdown, pointermove,
   pointerup and pointercancel handlers (item drag, picking box, pan, pinch hand-off), the
   Select area button, `cancelDrag`, `cancelBox`, `capture`, `setAreaMode`, double-click and
   wheel, exported as `initGestures()`.
   *Done when:* the step checks pass and `grep -c 'addEventListener("pointerdown"' src/app/main.ts` is 0.

7. **Keyboard → `src/app/keys.ts`** (both `keydown` listeners, `pickAllSymbols`) as
   `initKeys()`; **clipboard → `src/app/clipboard.ts`** (`copyPicked`, `cutPicked`,
   `pasteClipboard`, their buttons); **resizing → `src/app/resize.ts`** (handles,
   `resizeInPlace`, Smaller and Bigger).
   *Done when:* the step checks pass and all three files exist
   (`ls src/app/keys.ts src/app/clipboard.ts src/app/resize.ts`).

8. **Palette → `src/app/palette.ts`** (Add symbols: `ADD_KINDS`, open, close, grid,
   choose, `placeAt`, `settlementName`) and **editing actions → `src/app/actions.ts`**
   (Swap, Forward, Back, Delete, rename form and its "Suggest another" button for titles,
   edit-mode button).
   *Done when:* the step checks pass and both files exist.

8b. **Symbol loading → `src/app/ink.ts`**: `loadInk`, `loadKinds`, `usedKinds`,
   `CORE_KINDS`, `buildSprites`, `spritesWanted` (the pictures themselves stay in
   `sprites.ts`).
   *Done when:* the step checks pass and `grep -c 'function loadKinds' src/app/ink.ts` is 1.

9. **Sharing, export and keeping → `src/app/panels.ts`**: the share link (`updateLink`,
   Copy link), SVG and PNG export buttons, Save to My maps and Publish.
   *Done when:* the step checks pass and `grep -c 'updateLink' src/app/panels.ts` is at
   least 1.

10. **What is left in `main.ts`:** startup (reading the link), the settings form (including
    the Border and Coast choices, which redraw without generating, and the sliders, which
    regenerate when let go),
    `draw`, `paint`, `svgFor`, the relief overlay, `applyView` and `previewView`, and the
    calls to the `init...()` functions, with a short comment at the top listing the
    modules and what each does.
    *Done when:* the step checks pass and `wc -l < src/app/main.ts` is under 450.

11. **Full check.** `npm run typecheck`, `npm test`, `npm run e2e` (all browsers), and
    `public/app.js` within 5% of its baseline size (step 1). Add a "Page code" section to
    README.md listing the `src/app/` modules in one line each.
    *Done when:* all checks exit 0, the size is within 5%, and
    `grep -c 'Page code' README.md` is at least 1.
