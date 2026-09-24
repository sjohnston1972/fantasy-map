-- Public map gallery. A map is stored as its share link (settings code plus edits), a name
-- and a thumbnail in R2 at gallery/<id>.jpg. Nothing about the person who published it is
-- kept (spec: no accounts, no personal data).

CREATE TABLE gallery (
  id       TEXT PRIMARY KEY,        -- 12 random hex characters
  name     TEXT NOT NULL,           -- chosen by the publisher, up to 60 characters
  code     TEXT NOT NULL,           -- settings share code, e.g. 1.acm9.p.35.50.60.5
  edits    TEXT NOT NULL DEFAULT '',-- edits part of the link (URL-safe base64), may be empty
  created  TEXT NOT NULL,           -- ISO date and time
  hidden   INTEGER NOT NULL DEFAULT 0 -- 1 when taken down from the admin page
);

CREATE INDEX gallery_newest ON gallery (hidden, created DESC);
