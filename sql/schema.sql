-- Applied automatically on server startup (see src/db.js) — you never need to
-- run this by hand, it's here for reference / manual inspection.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  ms_oid        TEXT UNIQUE,                 -- Microsoft account object id, set on first real sign-in
  role          TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'officer' | 'manager'
  status        TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'denied'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at   TIMESTAMPTZ,
  approved_by   TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id               SERIAL PRIMARY KEY,
  sn               INTEGER,
  description      TEXT NOT NULL,
  entity           TEXT,
  owner_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_to_name TEXT,
  planned_start    DATE,
  actual_start     DATE,
  actual_end       DATE,
  due_date         DATE,
  completion_pct   INTEGER NOT NULL DEFAULT 0,
  remarks          TEXT,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_user_id);

CREATE TABLE IF NOT EXISTS task_history (
  id        SERIAL PRIMARY KEY,
  task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_name   TEXT,
  changes   JSONB
);
CREATE INDEX IF NOT EXISTS idx_history_task ON task_history(task_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT UNIQUE NOT NULL,
  subscription  JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- express-session's connect-pg-simple store creates its own "session" table
-- automatically on first run.
