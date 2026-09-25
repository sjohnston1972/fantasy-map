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
