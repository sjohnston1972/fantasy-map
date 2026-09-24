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

## Map milestone 7 decisions (catalogue and packs)

- **Icons were imported by script, approved by rule** (Steven's choice): rows whose OCR'd
  title matches a map role were imported; icons were approved when the splitter raised no
  flags, they clear the sheet edge and trace to a real drawing; flagged ones were rejected.
  182 approved, 14 rejected, across 11 sheets. Each icon's subtype is its map role.
- **No Access service token**: the API token could not create one, so the import script
  talks to R2 and D1 directly through Cloudflare's API, running the Worker's own import code
  (scripts/cf-storage.ts). No change to Access was needed.
- **Rate limiting** uses the Workers rate-limiting binding (120 requests a minute per
  visitor on /api/packs and /api/catalogue). The API token cannot manage zone rules; a zone
  rule can still be added in the dashboard if wanted.
- **Packs** are versioned JSON files (packs/<role>-v<n>.json) with a manifest; a rebuild
  only bumps roles whose icons changed. The map draws immediately with placeholders and
  swaps in ink symbols when the packs arrive. Each placement has a white knockout behind it
  so overlapping symbols stay readable.
- **Placement layout does not depend on the packs**: symbols are fitted inside the boxes
  the placement stage chose, so the same seed gives the same layout whatever icons exist.

## Map milestone 8 decisions (labels and emblems)

- **Names by region** (Steven's choice): Norse in the cold north, Celtic in the west, Old
  English in the heartland, softer southern names in the warm south; the boundaries shift
  with the seed. Names join a first part and an ending (Thorn + wick) and are unique on a map.
- **Named on each map:** every settlement, the sea, up to seven regions (forests, mountain
  ranges, marshes, deserts, wilds), lakes big enough to letter, and the biggest rivers
  (lettered along their course).
- **Collision rules:** labels never overlap each other, settlements, landmarks, bridges or
  emblems; scattered symbols (trees, hills) under lettering are removed, as engravers left
  space for names. Crowded settlements search further out, then use slightly smaller type.
- **Emblems:** a heraldic banner (from the emblem pack) beside the capital and the next two
  largest towns.
- **Text width is estimated** from the typeface's average letter width, so the generator
  gives the same layout everywhere (browser, tests, scripts).

## Map milestone 9 decisions (editing and export)

- **Edits sit on top of the map** as a list of changes (moved, deleted, swapped drawing,
  new wording), not written into it. The generator stays deterministic and undo is just the
  previous list. Edits belong to one map: regenerating or changing a setting clears them.
- **Edit mode is a button** ("Edit the map"), so on a tablet a drag scrolls the page until
  the visitor chooses to edit. Picking: click or tap an item, or press N (Shift+N goes back).
  Drag or arrow keys move it, S swaps the drawing, Delete removes, Ctrl+Z undoes. Labels
  get a wording box; an empty name deletes the label.
- **Share links carry the settings only, not edits** (spec: "maps shared by seed code").
  Open question: should a later version also pack small edit lists into the link?
- **The ground layer is drawn once per map** and reused while editing, so an edit redraws
  only the symbols and lettering.
- **Fonts are self-hosted** (IM Fell by Igino Marini, SIL Open Font Licence, via
  @fontsource) instead of Google Fonts. Saved SVG files carry the regular and italic faces
  inside them (about 120 KB), so they look right on any machine.
- **PNG sizes:** screen is the map's own size (1600 by 2263); A3 at 300 dpi is 3508 by
  4961 (landscape swapped). Open question: some phones (older iOS Safari) cap canvases at
  about 16.7 million pixels, just under A3 at 300 dpi; there the A3 PNG may fail with a
  message, and the SVG is the fallback.

## Map milestone 10 decisions (share links and polish)

- **Share code format:** dot-separated fields, `1.acm9.p.35.50.60.5` = generator version,
  seed in base 36, shape (p, l, or WxH), sea, mountains and forests in per cent, towns. The
  page keeps the current map's link in the address bar (no extra history entries), plus a
  Copy link button. Opening the page without a link starts on a random seed.
- **Old links:** a test pins the map drawn by one known link. If a future change alters
  generation, that test fails on purpose. Open question for then: bump `v` and keep the old
  generator for v1 links, or accept that old links draw a slightly different map.
- **"Map check"** under the map is a short fingerprint of the plain drawing, so two people
  can see at a glance that a link gave them the same map. Checked: Node and Chrome agree.
  Not yet checked in Firefox or Safari, whose maths functions may differ in the last digit;
  a mismatch there would show as a different map check.
- **Settings panel** now has forests and towns sliders (1 to 15 towns), completing the
  spec's list.
- **Phones:** the map comes first and the settings follow; edit mode stops the page
  scrolling only while switched on. Not tested on a real tablet or phone yet (the browser
  window could not be resized here).
- **Speed:** a map draws in about 1.2 to 1.8 s on this machine; the page code is about
  21 KB compressed plus three 58 KB font files, and symbol packs load afterwards.
