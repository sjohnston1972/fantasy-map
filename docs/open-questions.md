# Open questions

Things to decide in an interactive session. Items raised while building are added here
rather than built, per the working notes in the sheet import spec.

## Image classification for icons

Raised 2026-09-23 during sheet import milestone 3.

Could an image model classify icons automatically, for example suggesting a subtype
("saguaro", "barrel"), the kind (point or pattern), or which way an icon faces?

- The tool named was Jev (TypeSafe AI, https://www.langchain.com/blog/building-a-harness-with-jev).
  Jev is a fast classifier for **text and structured data, not images**: it answers a
  fixed-choice, score or yes/no question with a probability. It runs as a paid
  server-side API (needs a `TYPESAFE_API_KEY`); no licence details were published.
  - What Jev could do here: classify the OCR'd row title, for example map "skeletons &
    bones" to a standard category list, suggest `kind` (point or pattern) and `scales`.
    That is text-in, choice-out, which is what it is built for.
  - What it cannot do: look at the icon pictures (subtype, facing, duplicates).
- For the pictures themselves an image model is needed, for example CLIP (matches an
  image against text labels such as "a cactus"), which can run in the browser or on
  Cloudflare Workers AI.
- Where it would run: in the browser (small model download, keeps processing off the
  server as the spec requires) or on Cloudflare Workers AI (server side, which changes
  the spec's "all processing in the browser" rule).
- What it would fill in: subtype suggestions, pattern versus point, facing direction
  (the current rule-based guess is weak), or flagging near-duplicate icons across sheets.
- Cost and licence of the model.

## Facing detection is a rough guess

Milestone 3 sets `facing` automatically only for clearly lopsided icons, using which side
carries more ink. On the sample sheets this is right for most animals but can mislabel
shaded objects (the pyramid reads as facing right because of its hatching). Every
automatic value is marked "(auto)" in the review grid and can be overridden.

## Adding a box by hand

The review tools cannot draw a brand-new box around an icon the splitter missed
completely. Not in the spec; add it if it turns out to be needed.

## Potrace licence (GPL-2.0)

Raised 2026-09-23 during sheet import milestone 4. **Needs a decision before the import
page is public for good.**

The spec asks for potrace compiled to WebAssembly. Every available build, including the
one used (esm-potrace-wasm 0.5.1), is GPL-2.0 because Potrace itself is. Serving it to a
browser counts as distributing it.

What was done: potrace is served as its own unmodified file
(`/admin/import/potrace/potrace.js`) with its licence and a link to its source beside it,
and loaded at run time rather than bundled into the page code. The traced SVG icons are
program output and are not covered by the GPL.

Options:

1. Put the admin area behind Cloudflare Access (planned before milestone 5 anyway). Only
   the owner then receives the file, which removes the public distribution question.
2. Release this repository under GPL-2.0-or-later (or a compatible licence). The repo is
   public but currently has no licence at all.
3. Switch to vtracer (MIT licence, also compiled to WebAssembly, also named in the main
   spec). Output style differs from potrace; would need re-checking against the samples.

## Tracing ink level

Not in the spec. Tracing uses its own ink level (default 128, mid-grey) instead of the
splitter's threshold (200). At 200, the soft edges left by the 4x enlargement all count as
ink and fine hatching fills in; 128 keeps the SVG closest to the original drawing. It is
exposed in Trace settings next to the three potrace settings the spec lists.

## Review state storage (added in milestone 5)

Not in the spec's storage layout. Reopening a sheet "in its existing review state" (spec
8.3) needs the boxes, edits and row tags, which have no home in the D1 tables. They are
saved as `sheets/<sheetId>.review.json` in R2 next to the sheet PNG, through
`PUT /api/import/sheets/:id/review`, and saved automatically after every edit once
the sheet is in the library.

## Saved sheets cannot be re-split

Once any icon on a sheet is approved or rejected, changing a split setting is refused:
re-splitting would throw away the boxes the stored icons came from. The remaining draft
boxes can still be edited by hand. Approving or rejecting also clears undo history,
since those decisions live on the server.

## Potrace licence: resolved by Access (milestone 5)

`/admin` is now behind Cloudflare Access (only the owner can sign in), so the potrace file
is no longer served to the public. Revisit if the import page is ever opened to others.

## Library page limits (milestone 6)

The Library page loads the whole catalogue in one request (the API returns up to 1000
rows) and filters in the browser. Fine for Phase 1's target of 300 to 500 symbols; add
paging to `GET /api/import/icons` if the catalogue grows past about 1000. The page
reads only; it cannot edit tags or un-approve an icon (not in the spec). A stored sheet
can only be reopened by dropping its file again on the Import page.

## Map milestone 2 decisions

- **Sea level means share of water.** Heights are rescaled so that exactly `sea_level` of
  the map lies below it: 0.35 gives 35% water on every seed. The spec says "anything below
  a set height becomes water"; this keeps that literally true and makes the slider
  predictable.
- **Region maps have sea around the edges.** The ground sinks towards the frame and rises
  towards the middle, so a region map is a stretch of land with coast, like the example
  maps. Change this if some regions should run off the edge of the page.
- **Mountain density** (listed in the spec's settings panel but not in its share-code
  example) is included in the settings object; milestone 10 should add it to the code.
- **Speed.** A default 1600 by 2400 map takes about 0.4 s for this stage (height map at
  one value per 4 by 4 pixels).

## Map milestone 3 decisions (rivers and lakes)

- **Lakes are capped** at about 5 per 100,000 land cells (8 on a default map), chosen from
  inland water first, then the biggest hollows between 30 cells and 2% of the land. Noise
  terrain has many closed hollows; making every one a lake flooded the map (130 lakes).
- **Other hollows drain through a carved gorge** along the valley floor, the way real
  rivers cut through a rim; only tiny, shallow dips are filled flat. The terrain passed to
  later stages is this adjusted terrain (`water.heights`), so rivers are downhill on the
  ground the map actually shows.
- **River density** is fixed for now (a cell becomes river once it gathers rain from 0.25%
  of the land; about 95 river segments on a default map). The spec has no setting for it;
  worth adding if maps feel too wet or too dry once ink symbols are in.
- **Speed.** Rivers and lakes add about 0.25 s in Node and up to 0.5 s in the browser; a
  default map now takes about 1 s in total, against the spec's 10 s budget.

## Map milestone 4 decisions (biomes and placeholder symbols)

- **Map shapes are A-paper** (1 by 1.414): portrait 1600 by 2263 and landscape 2263 by 1600,
  so exports fit A3 and A4 exactly (decided with Steven). The square shape was dropped.
- **Biomes:** forest, grassland, marsh, mountain (spec), plus desert and tundra (requested).
  Farmland is laid around towns in milestone 5. Each map gets its own base climate from the
  seed, colder to the north and with height, so some maps are snowy and some arid.
- **The map is now drawn as SVG line art** (spec stage 8): inked coastline with two ripple
  lines out to sea, lake shores, rivers as tapered ink, a double-ruled border, and
  placeholder symbols. The grey relief is kept as an optional overlay for checking terrain.
- **Symbol rules:** big features first (mountains, hills), then trees, reeds, dunes, snow
  and grass; no two overlap by more than 20% of the smaller one; none stand in water or on
  a river; drawn back to front.

## Map milestone 5 decisions (towns and roads)

- **Town count** (spec setting) is the number of towns including the capital; villages add
  about two per town. Best sites score flat, low, fertile ground by rivers (bigger rivers
  better), the coast, lakes, and above all river mouths.
- **Settlements go on the largest landmass only.** Roads cannot reach islands without
  ferries, and the spec requires roads to connect every town. Island towns (with a ferry
  line) could come later.
- **Roads** join each settlement to the network by the cheapest route (A* over steepness
  and ground type), reusing existing roads so they merge into a network. They never enter
  the sea or a lake, never slip diagonally between river cells, and every river crossing
  gets a bridge (spec acceptance).
- **Farmland** is laid around each settlement on grassland and woodland; trees give way to
  fields, and no symbol stands on a road.
