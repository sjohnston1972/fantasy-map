# Sheet Import: Feature Spec

Part of the Ink Fantasy Map Generator (Cloudflare Workers static assets, R2, D1, generation in the browser).

## Working notes for Claude Code

- The owner is not a coder. Explain each new file and each design decision in plain English before moving on. Networking analogies land better than software idioms.
- Stop at the end of every milestone and show something that can be tested in a browser.
- Do not build beyond this spec. Note anything missing as an open question instead.
- No em-dashes anywhere in code comments, UI text or docs.

## 1. Purpose

Symbols for the map library are generated as batch sheets: one PNG holding a grid of icons on a white background, one category per row, with a text title above each row. The importer turns a sheet into individual, traced, tagged SVG icons in the library with as little manual work as possible.

## 2. Input format

Sheets follow this layout. The importer must tolerate imperfections, because image models do not produce exact grids.

- White background, black ink only.
- Rows of icons, 8 per row by default, one category per row.
- A short text title above each row (for example "ROCK FORMATIONS").
- Wide white gutters between rows and between icons.
- Typical size today: 1024 by 1536 px. Larger sheets must work without changes.

Reference test sheet: `desert.png` (11 rows, 88 icons). Expected result with default settings: 11 rows detected, 87 or more icons boxed, two rows where the title text touches the first icon.

## 3. User flow

1. Admin opens the Import page and drops a PNG.
2. The sheet is split automatically. A review grid appears within 2 seconds: the sheet image with a box around every detected icon and a detected title for each row.
3. The user corrects any mistakes: merge, split, delete or resize boxes; edit row titles.
4. The user confirms tags per row (category, subtype, scale, kind). Every icon in the row inherits them; single icons can be overridden.
5. The user clicks Trace. Each icon is traced to SVG in the browser and shown beside its PNG crop.
6. The user approves or rejects each icon, or approves the whole row.
7. Approved icons upload to R2 (SVG and PNG) and get a catalogue row in D1 with status `approved`. Rejected icons are recorded with status `rejected` so the same cell is not re-imported later.

## 4. Splitting algorithm

All of this runs in the browser on a canvas. No server compute.

### 4.1 Ink mask

- Convert to greyscale.
- Pixels darker than the threshold (default 200 of 255) are ink; the rest are background.

### 4.2 Row detection (gutters)

- Sum the ink in every horizontal line of pixels to get a row profile.
- A run of lines with zero ink longer than `rowGap` (default 12 px at 1024 wide; scale with sheet width) is a gutter.
- The bands between gutters are candidate rows.

### 4.3 Title strip detection

- Within each band, find blobs (4.5). A band whose total height is under `titleMaxHeight` (default 25 px) and whose content is wider than `titleMinWidth` (default 60 px) is a title strip, not an icon row.
- A title strip that was not separated by a gutter (text sitting close to the row) is detected as a wide, short cluster of small blobs at the top left of an icon row. Erase it from the mask before column detection, and keep its pixels for OCR.
- Pair each title strip with the icon row directly beneath it.

### 4.4 Column detection

- Within each icon row, sum the ink in every vertical line of pixels.
- Runs of zero ink longer than `colGap` (default 14 px) are gutters. The spans between them are cells.

### 4.5 Blob fallback

- Inside each cell, dilate the ink by `mergeRadius` (default 9 px) and find connected components.
- If a cell contains more than one component after dilation, the largest is the icon and the rest are offered as "possible split" in the review grid.
- Discard components smaller than `noiseSize` (default 12 px) in both dimensions.
- If a cell is wider than 1.6 times the row's median cell width, flag it as "possible merge".

### 4.6 Crop

- Bounding box of the ink in the cell (from the original mask, not the dilated one), plus `padding` (default 2 px).
- Anchor point: horizontal centre of the box, bottom edge of the box. Store as a fraction of width and height.
- Name: `<sheetId>-r<row>-c<col>`.

### 4.7 Settings exposed in the UI

Threshold, rowGap, colGap, mergeRadius, noiseSize, padding, expected icons per row. Changing any setting re-runs the split live.

## 5. Row titles and OCR

- Run in-browser OCR (tesseract.js) on each title strip. Pre-fill the row's category field with the result, lower-cased and trimmed.
- OCR is a convenience, not a dependency. If it fails, the field is empty and the user types the category.

## 6. Tagging

Tags per row, inherited by every icon in the row, editable per icon.

| Field | Values | Notes |
| --- | --- | --- |
| category | free text, lower case | for example `rock-formation`, `cactus`, `oasis` |
| subtype | free text, optional | for example `arch`, `hoodoo`, `barrel` |
| scale | one or more of `region`, `world`, `town`, `dungeon` | which map types may use it |
| kind | `point` or `pattern` | `pattern` icons are tiled across an area (sand dots, wind marks); `point` icons are placed once |
| facing | `left`, `right`, `none` | set automatically if the icon is clearly asymmetric; lets the generator mirror safely |

## 7. Tracing

- Trace each PNG crop to SVG in the browser using potrace compiled to WebAssembly.
- Default potrace settings tuned for pure black line art: `turdsize` 2, `alphamax` 1.0, `opttolerance` 0.2. Expose these as advanced settings.
- Output SVG must be a single `<svg>` with a `viewBox` equal to the crop size, black fill, no stroke, no embedded raster.
- Show PNG and SVG side by side in the review grid before approval.
- If the median icon height is under `minPrintHeight` (default 300 px), show a warning that the sheet is screen-quality only, and offer a 4x upscale (bicubic) before tracing.

## 8. Storage

### 8.1 R2 layout

```
sheets/<sheetId>.png                original upload
icons/<iconId>.png                  crop, after any upscale
icons/<iconId>.svg                  traced icon
packs/<packName>-v<n>.json          bundles of SVG strings for the generator (built separately)
```

### 8.2 D1 tables

```sql
CREATE TABLE sheets (
  id          TEXT PRIMARY KEY,      -- SHA-256 of the file, first 16 hex chars
  filename    TEXT NOT NULL,
  width_px    INTEGER NOT NULL,
  height_px   INTEGER NOT NULL,
  rows_found  INTEGER NOT NULL,
  icons_found INTEGER NOT NULL,
  settings    TEXT NOT NULL,          -- JSON of the split settings used
  source_tool TEXT,                   -- which image model made it
  created     TEXT NOT NULL           -- ISO date
);

CREATE TABLE icons (
  id          TEXT PRIMARY KEY,      -- <sheetId>-r<row>-c<col>
  sheet_id    TEXT NOT NULL REFERENCES sheets(id),
  row_index   INTEGER NOT NULL,
  col_index   INTEGER NOT NULL,
  category    TEXT NOT NULL,
  subtype     TEXT,
  scales      TEXT NOT NULL,          -- comma-separated
  kind        TEXT NOT NULL,          -- point | pattern
  facing      TEXT NOT NULL DEFAULT 'none',
  width_px    INTEGER NOT NULL,
  height_px   INTEGER NOT NULL,
  anchor_x    REAL NOT NULL,          -- 0 to 1
  anchor_y    REAL NOT NULL,          -- 0 to 1
  status      TEXT NOT NULL,          -- draft | approved | rejected
  png_key     TEXT NOT NULL,
  svg_key     TEXT,
  created     TEXT NOT NULL,
  updated     TEXT NOT NULL
);

CREATE INDEX icons_by_category ON icons(category, status);
```

### 8.3 Duplicate handling

- The sheet id is a hash of the file. Re-uploading a sheet already in `sheets` opens the existing review state instead of creating a new one.
- An icon cell with status `approved` or `rejected` is shown but locked on re-import.

## 9. Worker API

All routes under `/api/import/`, protected by Cloudflare Access. The Worker only moves files and rows; it does no image processing.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/import/sheets` | Register a sheet (metadata + upload URL for R2) |
| GET | `/api/import/sheets/:id` | Sheet metadata and its icons |
| PUT | `/api/import/icons/:id` | Update tags, status, anchor |
| POST | `/api/import/icons/:id/files` | Upload PNG and SVG for one icon |
| POST | `/api/import/sheets/:id/approve-row` | Approve every draft icon in a row |
| GET | `/api/import/icons?category=&status=` | Library listing for the admin page |

## 10. Review grid UI

- Left: the sheet with boxes. Colours: detected icon, title strip, possible merge, possible split, approved, rejected.
- Right: the selected row's tag panel, then the selected icon's PNG and SVG at 3x zoom with its tags.
- Tools: merge (select two boxes), split (draw a vertical line inside a box), delete, drag box edges, edit title, approve row, reject icon.
- Keyboard: arrow keys move between icons, A approves, R rejects, Enter opens the tag panel.
- Progress bar for trace and upload. Uploads run in parallel, 4 at a time.

## 11. Acceptance criteria

- [ ] `desert.png` splits into 11 rows and at least 87 icon boxes with default settings in under 2 seconds.
- [ ] Title strips are detected on every row of `desert.png`, including the two rows where text touches the first icon.
- [ ] OCR pre-fills at least 9 of the 11 row categories on `desert.png`.
- [ ] Merge, split, delete, resize and title edit all work in the review grid.
- [ ] Row tags apply to every icon in the row and a single icon can be overridden.
- [ ] Every approved icon has a PNG and an SVG in R2 and a row in D1 with correct tags, anchor and status.
- [ ] Re-uploading `desert.png` reopens the existing sheet and creates no duplicate rows.
- [ ] A sheet with icons under 300 px tall shows the resolution warning and the upscale option.
- [ ] All processing runs in the browser; the Worker receives only files and JSON.

## 12. Milestones

| # | Milestone | What can be tested when done |
| --- | --- | --- |
| 1 | Upload and split | Drop `desert.png`, see boxes and row titles on screen |
| 2 | Review tools | Merge, split, delete, resize, edit titles |
| 3 | Tagging and OCR | Row categories pre-filled; per-icon override |
| 4 | Tracing | PNG and SVG side by side; resolution warning |
| 5 | Storage | Approved icons appear in R2 and D1; re-upload is detected |
| 6 | Library page | Browse approved icons by category |

## 13. Out of scope

- Building the generator packs from approved icons (separate feature).
- Editing SVG paths by hand.
- Multi-user review or comments.
- Sheets with coloured or grey artwork.

## 14. Open questions

- Which image model generates the sheets, and does its licence allow public redistribution of the output? Record the answer in `sheets.source_tool`.
- Maximum sheet size the model can produce, which decides whether the upscale step is needed for print.