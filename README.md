# Ink Fantasy Map Generator

A free web app that procedurally generates black-and-white, hand-inked fantasy maps. Live at https://maps.clydeford.net

- `docs/fantasy-map.md`: main product spec, phases and build order
- `docs/sheet-import-spec.md`: admin tool that turns symbol sheets into library icons
- `example artifacts/`: reference symbol sheets and maps used for testing
- `src/worker.ts`: the Cloudflare Worker (API routes under `/api/`)
- `public/`: static files served to the browser

## Running it

```
npm install
npm run dev      # local preview at http://localhost:8787
npm run deploy   # publish to Cloudflare
```

Deploying needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in a local `.env` file, which is never committed.
