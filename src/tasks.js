const express = require("express");
const { query } = require("./db");
const { computeStatus } = require("./statusUtil");
const { requireAuth, requireApproved, requireManager } = require("./middleware");
const { sendPushToUser } = require("./push");

const router = express.Router();
// Every /api/* route needs a signed-in user. /api/me itself must work for a
// pending/denied user too (so the frontend can tell them apart from "signed
// out"), so "approved" is enforced per-route below rather than blanket here.
router.use("/api", requireAuth);

const FIELD_LABELS = {
  description: "description", entity: "entity", planned_start: "planned start", due_date: "due date",
  actual_start: "actual start", actual_end: "actual end", completion_pct: "completion", remarks: "remarks"
};
const EDITABLE_FIELDS = Object.keys(FIELD_LABELS);

function toRow(dbRow, ownerName) {
  return {
    id: dbRow.id,
    sn: dbRow.sn,
    description: dbRow.description,
    entity: dbRow.entity,
    ownerUserId: dbRow.owner_user_id,
    ownerName,
    assignedTo: dbRow.assigned_to_name,
    plannedStart: dbRow.planned_start,
    actualStart: dbRow.actual_start,
    actualEnd: dbRow.actual_end,
    dueDate: dbRow.due_date,
    completionPct: dbRow.completion_pct,
    remarks: dbRow.remarks,
    createdBy: dbRow.created_by,
    updatedBy: dbRow.updated_by,
    updatedAt: dbRow.updated_at,
    status: computeStatus(dbRow)
  };
}

router.get("/api/me", (req, res) => {
  res.json({
    id: req.user.id, name: req.user.name, email: req.user.email,
    role: req.user.role, status: req.user.status
  });
});

router.get("/api/officers", requireApproved, requireManager, async (req, res) => {
  const { rows } = await query(
    "SELECT id, name, email FROM users WHERE status='approved' AND role='officer' ORDER BY name ASC"
  );
  res.json(rows);
});

router.get("/api/tasks", requireApproved, async (req, res) => {
  let sql = `SELECT t.*, u.name AS owner_name, u.id AS owner_id
             FROM tasks t JOIN users u ON u.id = t.owner_user_id`;
  const params = [];
  if (req.user.role !== "manager") {
    sql += " WHERE t.owner_user_id = $1";
    params.push(req.user.id);
  }
  sql += " ORDER BY t.sn ASC NULLS LAST, t.id ASC";
  const { rows } = await query(sql, params);
  res.json(rows.map((r) => toRow(r, r.owner_name)));
});

router.get("/api/tasks/:id/history", requireApproved, async (req, res) => {
  const task = await loadTaskForViewer(req, req.params.id);
  if (!task) return res.status(404).json({ error: "not_found" });
  const { rows } = await query(
    "SELECT at, by_name, changes FROM task_history WHERE task_id = $1 ORDER BY at DESC", [task.id]
  );
  res.json(rows);
});

async function loadTaskForViewer(req, id) {
  const { rows } = await query("SELECT * FROM tasks WHERE id = $1", [id]);
  const t = rows[0];
  if (!t) return null;
  if (req.user.role !== "manager" && t.owner_user_id !== req.user.id) return null;
  return t;
}

router.post("/api/tasks", requireApproved, async (req, res) => {
  const body = req.body || {};
  if (!body.description || !body.description.trim()) {
    return res.status(400).json({ error: "description_required" });
  }

  let ownerUserId = req.user.id;
  let assignedToName = "";
  if (req.user.role === "manager" && body.assigneeUserId) {
    const { rows } = await query(
      "SELECT id, name FROM users WHERE id = $1 AND status='approved' AND role='officer'",
      [body.assigneeUserId]
    );
    if (!rows[0]) return res.status(400).json({ error: "invalid_assignee" });
    ownerUserId = rows[0].id;
    assignedToName = rows[0].name;
  }

  const maxSn = await query("SELECT COALESCE(MAX(sn),0)::int AS m FROM tasks");
  const sn = maxSn.rows[0].m + 1;

  const inserted = await query(
    `INSERT INTO tasks
      (sn, description, entity, owner_user_id, assigned_to_name, planned_start, actual_start,
       actual_end, due_date, completion_pct, remarks, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
    [
      sn, body.description.trim(), (body.entity || "").trim(), ownerUserId, assignedToName,
      body.plannedStart || null, body.actualStart || null, body.actualEnd || null, body.dueDate || null,
      Number(body.completionPct) || 0, (body.remarks || "").trim(), req.user.name
    ]
  );
  const task = inserted.rows[0];
  await query(
    "INSERT INTO task_history (task_id, by_name, changes) VALUES ($1,$2,$3)",
    [task.id, req.user.name, JSON.stringify([{ field: "created" }])]
  );

  if (ownerUserId !== req.user.id) {
    sendPushToUser(ownerUserId, {
      title: "New task assigned to you",
      body: task.description
    }).catch(() => {});
  } else if (req.user.role === "officer") {
    notifyManagerOfNewOfficerTask(req.user, task).catch(() => {});
  }

  var ownerNameForResponse = ownerUserId === req.user.id ? req.user.name : assignedToName;
  res.json(toRow(task, ownerNameForResponse));
});

router.put("/api/tasks/:id", requireApproved, async (req, res) => {
  const existing = await loadTaskForViewer(req, req.params.id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  const body = req.body || {};

  const updates = {
    description: body.description != null ? String(body.description).trim() : existing.description,
    entity: body.entity != null ? String(body.entity).trim() : existing.entity,
    planned_start: body.plannedStart !== undefined ? (body.plannedStart || null) : existing.planned_start,
    actual_start: body.actualStart !== undefined ? (body.actualStart || null) : existing.actual_start,
    actual_end: body.actualEnd !== undefined ? (body.actualEnd || null) : existing.actual_end,
    due_date: body.dueDate !== undefined ? (body.dueDate || null) : existing.due_date,
    completion_pct: body.completionPct != null ? Number(body.completionPct) || 0 : existing.completion_pct,
    remarks: body.remarks != null ? String(body.remarks).trim() : existing.remarks
  };

  const changes = [];
  EDITABLE_FIELDS.forEach((f) => {
    const before = existing[f] == null ? "" : String(existing[f]);
    const after = updates[f] == null ? "" : String(updates[f]);
    if (before !== after) changes.push({ field: FIELD_LABELS[f], from: before, to: after });
  });

  let newOwnerId = existing.owner_user_id;
  let newAssignedName = existing.assigned_to_name;
  let reassigned = false;
  if (req.user.role === "manager" && body.assigneeUserId !== undefined) {
    const targetId = body.assigneeUserId || req.user.id;
    if (targetId !== existing.owner_user_id) {
      if (targetId === req.user.id) {
        newOwnerId = req.user.id;
        newAssignedName = "";
      } else {
        const { rows } = await query(
          "SELECT id, name FROM users WHERE id=$1 AND status='approved' AND role='officer'", [targetId]
        );
        if (!rows[0]) return res.status(400).json({ error: "invalid_assignee" });
        newOwnerId = rows[0].id;
        newAssignedName = rows[0].name;
      }
      changes.push({ field: "assigned to", from: existing.assigned_to_name || "(manager)", to: newAssignedName || "(manager)" });
      reassigned = true;
    }
  }

  await query(
    `UPDATE tasks SET description=$1, entity=$2, planned_start=$3, actual_start=$4, actual_end=$5,
       due_date=$6, completion_pct=$7, remarks=$8, owner_user_id=$9, assigned_to_name=$10,
       updated_by=$11, updated_at=now()
     WHERE id=$12`,
    [
      updates.description, updates.entity, updates.planned_start, updates.actual_start, updates.actual_end,
      updates.due_date, updates.completion_pct, updates.remarks, newOwnerId, newAssignedName,
      req.user.name, existing.id
    ]
  );

  if (changes.length) {
    await query(
      "INSERT INTO task_history (task_id, by_name, changes) VALUES ($1,$2,$3)",
      [existing.id, req.user.name, JSON.stringify(changes)]
    );
  }

  if (reassigned && newOwnerId !== req.user.id) {
    sendPushToUser(newOwnerId, { title: "A task was assigned to you", body: updates.description }).catch(() => {});
  }

  const { rows } = await query(
    "SELECT t.*, u.name AS owner_name FROM tasks t JOIN users u ON u.id=t.owner_user_id WHERE t.id=$1",
    [existing.id]
  );
  res.json(toRow(rows[0], rows[0].owner_name));
});

router.delete("/api/tasks/:id", requireApproved, requireManager, async (req, res) => {
  await query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

router.get("/api/export.csv", requireApproved, async (req, res) => {
  let sql = `SELECT t.*, u.name AS owner_name FROM tasks t JOIN users u ON u.id = t.owner_user_id`;
  const params = [];
  if (req.user.role !== "manager") {
    sql += " WHERE t.owner_user_id = $1";
    params.push(req.user.id);
  }
  sql += " ORDER BY t.sn ASC NULLS LAST";
  const { rows } = await query(sql, params);

  const esc = (v) => {
    v = v == null ? "" : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const header = ["SN", "Task Description", "Entity/Div", "Officer", "Planned Start", "Actual Start", "Actual End", "Due Date", "Completion %", "Status", "Remarks"];
  const lines = [header.join(",")];
  rows.forEach((t) => {
    lines.push([
      t.sn, t.description, t.entity, req.user.role === "manager" ? t.owner_name : "",
      fmt(t.planned_start), fmt(t.actual_start), fmt(t.actual_end), fmt(t.due_date),
      t.completion_pct, computeStatus(t), t.remarks
    ].map(esc).join(","));
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="HSE-Task-Report.csv"');
  res.send(lines.join("\r\n"));
});
function fmt(d) { return d ? new Date(d).toISOString().slice(0, 10) : ""; }

router.get("/api/push/public-key", (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});
router.post("/api/push/subscribe", requireApproved, async (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "bad_subscription" });
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, subscription)
     VALUES ($1,$2,$3) ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription`,
    [req.user.id, sub.endpoint, sub]
  );
  res.json({ ok: true });
});
router.post("/api/push/unsubscribe", async (req, res) => {
  if (req.body && req.body.endpoint) {
    await query("DELETE FROM push_subscriptions WHERE endpoint = $1", [req.body.endpoint]);
  }
  res.json({ ok: true });
});

async function notifyManagerOfNewOfficerTask(officer, task) {
  const { rows } = await query("SELECT id FROM users WHERE role='manager' LIMIT 1");
  if (rows[0]) {
    await sendPushToUser(rows[0].id, { title: `New task from ${officer.name}`, body: task.description });
  }
}

module.exports = { router, toRow };
