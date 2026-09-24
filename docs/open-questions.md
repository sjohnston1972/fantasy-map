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

## After Phase 1: layering, edits in links, gallery, frame

- **Layering** (Steven's request): symbols can be brought forward or sent back past the
  symbol they overlap (buttons, or ] and [; Shift for all the way). Each symbol has a white
  outline behind it, so the one in front hides the ink of the one behind. Layering covers
  mountains, hills, trees and fields; towns, landmarks, banners and names stay on their own
  layers above them. Moving a symbol does not change its layer.
- **Share links carry edits** (Steven's choice): `&e=` holds the edits, packed with deflate
  and URL-safe base64. Links from before this change still work. A link's edits are checked
  and limited when read (no more than 5,000 changes, 256 KB unpacked).
- **Gallery** (Steven's choice: both kinds):
  - *My maps* lives in the browser's local storage: link, name and a small JPEG. It does
    not follow the visitor to another device. Storage holds roughly 70 maps.
  - *Everyone's maps* is public. Publishing asks twice, stores only the link, a name and a
    thumbnail (D1 table `gallery`, pictures in R2 at `gallery/<id>.jpg`), nothing about the
    person. Limits: 5 publishes a minute per visitor; names up to 60 characters with no web
    addresses; thumbnails must be real JPEGs up to 480 by 700 and 120 KB; the request must
    come from the map page.
  - Entries go live at once; `/admin/gallery/` (behind Access) can hide, show or delete
    them. **Open question:** is after-the-fact review enough, or should new entries wait
    for approval? And should visitors be able to report a map?
  - This goes beyond the spec, which put saved galleries out of Phase 1 and said no maps
    are stored on the server; Steven asked for it.
- **Frame and margin:** maps now have plain paper outside a double-ruled border (2.5% of
  the short side, about 7 mm on A3), and the drawing is scaled about 6% to sit inside it,
  cut off at the inner rule. The generated map is unchanged, so links still match. The
  "map check" code under the map changed with the new drawing; the test that pins old
  links now checks the generated map data instead of the drawing.

## Zoom, and adding symbols from the library

- **Zoom** changes the SVG's viewBox, so ink stays sharp: + and - buttons on the map, the
  mouse wheel or trackpad pinch, two-finger pinch on touch screens, double-click (outside
  edit mode), and the + - 0 keys. Up to 8 times closer. Zoomed in, a drag pans (and on a
  phone the page stops scrolling under the map until it is zoomed back out). The view is
  kept while sliders change the same-sized map. Exports always cover the whole map.
- **Adding symbols** (Steven: "add artifacts from the gallery", read as drawings from the
  symbol library): edit mode has "Add symbols", a palette of every drawing by kind
  (mountains, trees, towns, landmarks, banners and so on). Pick one, click the map to
  place it, keep clicking to place more. The chosen drawing is always the one placed.
  "Vary size and facing" (on by default) gives each copy a size within 15% and a random
  facing; "Mix drawings of this kind" (off by default) picks any drawing of the kind instead
  (Steven found the old mixing default surprising). Added symbols go
  in front of generated ones, travel in share links and gallery entries, and can be moved,
  swapped, layered and deleted.
  - Fields have no drawings in the library yet, so they are not offered.
  - Added towns are just drawings: they get no name, roads or banner. Open question: should
    placing a town also add a name label?
  - A drawing is remembered by its position in its pack, so rebuilding a pack with new
    icons can change which drawing an old link shows (the same is true of swaps).

## Smooth panning, picking several items, copy and paste

- **Smooth panning:** mid-gesture the drawn picture is moved with a CSS transform and the
  map is redrawn once when the gesture ends (a redraw costs about 40 to 150 ms; before,
  every pointer move paid it). The map sits on its own graphics layer (will-change) and is
  drawn a quarter of a view past each edge of the box, so short drags show real map and
  longer ones show blank paper at the edge until the redraw. (A first attempt drew the
  whole map past the edges, which made each frame of a drag take over a second.)
- **Picking several items:** Shift-click or Ctrl-click adds or removes; Shift-drag on empty
  map (or "Select area", for touch screens) picks everything the box touches; Ctrl+A picks
  every symbol in view. "Select area" switches itself off after one box, and a drag that
  starts on a picked item always moves the group. Moving (drag or arrows), Delete, Swap and layering apply to all
  picked items as one undo step. Renaming needs exactly one name picked.
- **Copy and paste:** Copy, Cut, Paste buttons and Ctrl+C, Ctrl+X, Ctrl+V. Copies keep
  their layout and paste centred on the pointer (or the middle of the view from the
  button), picked and ready to drag. Towns, landmarks, bridges and banners copy as plain
  drawings (no name, roads or banner). Names are not copied. The copies live on the page,
  not the system clipboard, and survive generating a new map.
  - Open question: pasting many items makes long links (47 pasted symbols made a link of
    about 1,200 characters). Fine for copying and gallery entries; some chat apps may cut
    very long links.

## Generator version 2: forests in stands, overlapping trees

- Steven: "trees should group by type and be tighter together/overlapping".
- **Stands:** pine or leafy is now decided over stands (the climate's choice averaged over
  about 60 map pixels, nudged by slow noise), not cell by cell, so forests are solid
  patches of one kind instead of a speckle. A test checks trees' nearest neighbours are
  mostly the same kind (under 8% mixed on the test seed).
- **Overlap:** trees are drawn larger than the gap between them (pines 16 to 21 px on a
  10.5 px grid, leafy trees 18 to 24 px on 11.5 px) and may overlap other trees by up to
  60%, drawn back to front with their white outlines. **This relaxes the spec's "no two
  symbols overlap by more than 20%" rule for tree on tree only**; every other pair keeps 20%.
- **Cost:** about 35% more symbols than version 1 (3,944 against 2,842 on the default
  seed); generation still about 1.4 s.
- **Old links keep working:** the settings' `v` field is now used. Links, saved maps and
  gallery entries made before this say `v` 1 and are drawn with the version 1 forests, so
  their edits still land on the same symbols. Any change on the page (new seed, a slider)
  draws with the newest version. Links from a newer version than the page knows are drawn
  with the newest it has, with a note.

## Picking and dragging fixes

- Steven: "Selecting and dragging is clunky and unusable. Sometimes elements dont select,
  sometimes they fail to drag."
- **Cause 1, picking:** browsers only count a click as on a drawing where there is ink, and
  these drawings are mostly gaps. Measured on the default map, a click in the middle of a
  mountain missed 40% of the time, hills 31%, bridges 5 in 8, names 1 in 8; a miss picked
  nothing, and when zoomed in the drag panned the map instead. Now anything whose drawn box
  is under the pointer can be picked (the one whose ink is hit, else the one drawn on top).
  Measured again: no misses; a click takes about 24 ms.
- **Cause 2, freezes:** every change rebuilt the whole drawing (100 to 150 ms of script,
  plus the browser's redraw). Moves (drag or arrows) and deletes now update only the items
  concerned (4 to 7 ms). Swaps, layering, pasting and undo still rebuild.

## Resizing

- Steven: "Add a resize option on element select", then "Resize by dragging a bounding box".
- Picked items get a dashed box with a handle on each corner; dragging a handle resizes
  everything inside about the opposite corner (sizes and spacing both scale, like resizing a
  picture). Smaller and Bigger buttons, and the , and . keys, resize each picked item in
  place instead (a forest's trees grow where they stand).
- Works for symbols, added drawings, towns, landmarks, bridges, banners (drawn size) and
  names (type size, growing up from the baseline). Sizes are kept between 0.2 and 5 times
  the drawn size, travel in share links (as `r`), and copies keep them.
- Towns and names keep their positions for labelling purposes: a much bigger town does not
  push its name away, so very large resizes may need the name moved by hand.

## Editor overhaul: browser tests, fast edits, redo, tidier layout, names follow towns

- **Browser tests** (`npm run e2e`, Playwright): the editing gestures driven with real mouse
  and touch input in Chrome's, Firefox's and Safari's engines (WebKit) and on phone and
  tablet screens, against a test server with stand-in drawings (e2e/server.mjs). They also
  check the map check code is identical in every engine. Writing them found five real bugs:
  - Firefox reports drawings placed with `<use>` at a fraction of their size, so box select,
    Ctrl+A and the resize box were wrong there. The page now uses its own geometry.
  - Picking an item changed the hint text above the map; where it wrapped to another line
    (Safari's type measures differently) the whole map jumped down under the pointer.
    Changing text and the wording box now sit over the map instead.
  - The resize handles covered small picked items (a tree is smaller than a handle), so they
    could not be dragged: the handles now sit outside the box.
  - A name or town drawn over a picked group took the drag instead of the group: picked
    items now win.
  - Entering edit mode scrolled the page (focus); it no longer does.
- **Every edit redraws only what it touched** (swap, layering, resize, paste, rename, delete,
  undo, redo), in a few milliseconds instead of rebuilding the whole map. A test checks the
  patched map is identical, item for item, to the same map drawn fresh from its link.
- **Redo:** button, Ctrl+Y or Ctrl+Shift+Z.
- **Layout:** the toolbar holds only what does not depend on the selection (Add symbols,
  Select area, Paste, Undo, Redo, keyboard shortcuts in a fold-out); actions for picked
  items float in a bar just above them; hints sit over the map's top-left corner; the
  palette opens beside the map on wide screens.
- **Names follow their town:** dragging, nudging or box-resizing a town brings its name and
  banner along (unless they were picked too). Added towns still have no name.
- The "map check" code changed once more, because the drawing now groups items by layer; the
  generated maps themselves are unchanged.

## Generator version 3: title box and compass rose; named added towns

- New maps (links starting `3.`) get a **title** in a framed box, named for the capital in
  the style of its region ("The Jarldom of ...", "The Kingdom of ...", "The Principality of
  ..."), and a **compass rose**. Each goes in the emptiest spot along the map's edges,
  preferring open sea, clear of towns and names; symbols under them are cleared, as for
  names. Both behave like names in the editor (move, delete, resize); the title can be
  reworded, the compass cannot. Links from earlier versions are unchanged.
- **Towns placed from the palette get a name** in the naming style of that part of the map.
  It is drawn as part of the town, so it moves and resizes with it; picking the town opens
  the wording box, and clearing the wording removes the name but keeps the town. Copies
  made with copy and paste are unnamed.
- Saved SVGs now also carry the small-capitals typeface the title uses.
- Open: a scale bar under the title, border styles, and a choice of title wording are
  natural next steps (Phase 2 lists "compass rose, border decoration and title cartouche
  options").
