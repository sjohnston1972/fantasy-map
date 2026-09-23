-- Sheet import catalogue (docs/sheet-import-spec.md section 8.2).

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
CREATE INDEX icons_by_sheet ON icons(sheet_id, row_index);
