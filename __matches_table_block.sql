CREATE TABLE IF NOT EXISTS matches (
  date DATE NOT NULL,
  match TEXT NOT NULL,
  tournament TEXT,
  link TEXT,
  seen BOOLEAN NOT NULL DEFAULT FALSE,
  comments TEXT
);
