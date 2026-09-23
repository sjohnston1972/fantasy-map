# Ink Fantasy Map Generator

A free web app that procedurally generates black-and-white, hand-inked fantasy maps. Live at https://maps.clydeford.net

- `docs/fantasy-map.md`: main product spec, phases and build order
- `docs/sheet-import-spec.md`: admin tool that turns symbol sheets into library icons
- `example artifacts/`: reference symbol sheets and maps used for testing
- `src/worker.ts`: the Cloudflare Worker (API routes under `/api/`)
- `src/import/split.ts`: splits a symbol sheet into rows, titles and icon boxes
- `src/import/review.ts`: the review edits (merge, split, delete, resize) and tags
- `src/import/ocr.ts`: prepares row titles for OCR and tidies the text
- `src/import/trace.ts`: traces an icon to SVG and a transparent PNG
- `src/import/tracing.ts`: loads potrace in the browser and keeps the results
- `src/import/app.ts`: the Sheet Import page at `/admin/import/`
- `docs/open-questions.md`: decisions waiting for an interactive session
- `test/`: automated checks, run with `npm test`
- `public/`: static files served to the browser

## Running it

```
npm install
npm run dev      # local preview (builds first) at http://localhost:8787
npm test         # run the automated checks
npm run deploy   # publish to Cloudflare
```

Deploying needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in a local `.env` file, which is never committed.
