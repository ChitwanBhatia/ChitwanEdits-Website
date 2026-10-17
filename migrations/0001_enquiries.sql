-- Contact form enquiries. `due` is when the next reminder email goes out; NULL once all are sent or stopped.
CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  message TEXT NOT NULL,
  page TEXT,
  at INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  due INTEGER
);
CREATE INDEX IF NOT EXISTS enquiries_due ON enquiries (due);
CREATE INDEX IF NOT EXISTS enquiries_at ON enquiries (at);
