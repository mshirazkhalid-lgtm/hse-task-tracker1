const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

async function query(text, params) {
  return pool.query(text, params);
}

async function ensureManagerRow() {
  const email = (process.env.MANAGER_EMAIL || "").trim();
  if (!email) {
    console.warn("MANAGER_EMAIL is not set — no account will be auto-approved as manager.");
    return null;
  }
  const existing = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
  if (existing.rows.length) {
    if (existing.rows[0].role !== "manager" || existing.rows[0].status !== "approved") {
      await query("UPDATE users SET role='manager', status='approved' WHERE id=$1", [existing.rows[0].id]);
    }
    return existing.rows[0].id;
  }
  const name = email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const inserted = await query(
    `INSERT INTO users (email, name, role, status, approved_at, approved_by)
     VALUES ($1, $2, 'manager', 'approved', now(), 'system') RETURNING id`,
    [email, name]
  );
  return inserted.rows[0].id;
}

async function seedHistoricalTasks(managerId) {
  if (!managerId) return;
  const count = await query("SELECT count(*)::int AS n FROM tasks");
  if (count.rows[0].n > 0) return; // already seeded (or has real data) — never overwrite

  const dataPath = path.join(__dirname, "..", "data", "historical-tasks.json");
  if (!fs.existsSync(dataPath)) return;
  const rows = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  console.log(`Seeding ${rows.length} historical tasks into the manager's bucket...`);
  for (const r of rows) {
    await query(
      `INSERT INTO tasks
        (sn, description, entity, owner_user_id, assigned_to_name, planned_start, actual_start,
         actual_end, due_date, completion_pct, remarks, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Import','Import')`,
      [
        r.sn, r.description, r.entity, managerId, r.assignedTo === "-" ? "" : (r.assignedTo || ""),
        r.plannedStart || null, r.actualStart || null, r.actualEnd || null, r.dueDate || null,
        r.completionPct || 0, r.remarks || ""
      ]
    );
  }
  console.log("Historical import complete.");
}

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "sql", "schema.sql"), "utf8");
  await pool.query(schema);
  const managerId = await ensureManagerRow();
  await seedHistoricalTasks(managerId);
}

module.exports = { pool, query, init };
