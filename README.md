# Ink Fantasy Map Generator

A free web app that procedurally generates black-and-white, hand-inked fantasy maps. Live at https://maps.clydeford.net

- `docs/fantasy-map.md`: main product spec, phases and build order
- `docs/sheet-import-spec.md`: admin tool that turns symbol sheets into library icons
- `example artifacts/`: reference symbol sheets and maps used for testing
- `src/gen/`: the map generator, one module per pipeline stage (seeded, runs in the browser)
- `src/app/`: the public map page at `/` (see "Page code" below)
- `src/worker.ts`: the Cloudflare Worker (API routes under `/api/`)
- `src/api/import.ts`: the sheet import API (R2 files, D1 catalogue)
- `src/api/auth.ts`: checks the Cloudflare Access sign-in on admin API calls
- `migrations/`: the D1 database schema
- `src/import/split.ts`: splits a symbol sheet into rows, titles and icon boxes
- `src/import/review.ts`: the review edits (merge, split, delete, resize) and tags
- `src/import/ocr.ts`: prepares row titles for OCR and tidies the text
- `src/import/trace.ts`: traces an icon to SVG and a transparent PNG
- `src/import/tracing.ts`: loads potrace in the browser and keeps the results
- `src/import/app.ts`: the Sheet Import page at `/admin/import/`
- `src/library/`: the Symbol Library page at `/admin/library/` (browse saved icons)
- `docs/open-questions.md`: decisions waiting for an interactive session
- `test/`: automated checks, run with `npm test`
- `public/`: static files served to the browser

## Page code

The map page (`src/app/`) is split by job:

- `main.ts`: starts the page from its link, runs the settings form, and draws the map
- `dom.ts`: the page's elements, looked up once
- `state.ts`: what the modules share (the map, its edits, the picked items, the zoom)
- `ink.ts`: loads the symbol drawings, and the pre-drawn pictures used on screen
- `history.ts`: records changes, undo and redo, and redraws only the items that changed
- `selection.ts`: picking items, and the box and action bar around the picked ones
- `gestures.ts`: dragging, picking boxes, and panning and zooming with the pointer
- `keys.ts`: the keyboard shortcuts
- `clipboard.ts`: copy, cut and paste
- `resize.ts`: resizing by the box's corners, and Smaller and Bigger
- `actions.ts`: edit mode, Swap, Forward, Back, Delete, and rewording names
- `palette.ts`: Add symbols
- `panels.ts`: saving SVG and PNG files, the share link, My maps and the public gallery
- `zoom.ts`, `sprites.ts`, `export.ts`, `share.ts`, `mymaps.ts`: helpers for zooming,
  the on-screen pictures, file export, share codes and My maps

## Running it

```
npm install
npm run dev      # local preview (builds first) at http://127.0.0.1:8799
npm test         # run the automated checks
npm run deploy   # publish to Cloudflare
```

Deploying needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in a local `.env` file, which is never committed.

`/admin` and `/api/import` are protected by Cloudflare Access (app "fantasy-map admin"). For local development, a `.dev.vars` file (never committed) containing `DEV_NO_AUTH=1` skips the sign-in check, and only for requests to 127.0.0.1. Before the first local run, create the local database with `npx wrangler d1 migrations apply fantasy-map-catalogue --local`.
