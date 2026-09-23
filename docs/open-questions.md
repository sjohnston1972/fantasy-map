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
