// One statement per entry (the Neon HTTP driver runs a single statement per call).
module.exports = [
  `CREATE TABLE IF NOT EXISTS users (
     id SERIAL PRIMARY KEY,
     name TEXT NOT NULL,
     pass_hash TEXT NOT NULL,
     is_admin BOOLEAN NOT NULL DEFAULT FALSE,
     failed_attempts INT NOT NULL DEFAULT 0,
     locked_until TIMESTAMPTZ
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_name_lower ON users (lower(name))`,
  `CREATE TABLE IF NOT EXISTS votes (
     user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     video_id TEXT NOT NULL,
     code SMALLINT NOT NULL CHECK (code IN (-1, 0, 1, 2)),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, video_id)
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
];
