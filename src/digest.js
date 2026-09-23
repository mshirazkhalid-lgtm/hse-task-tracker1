const cron = require("node-cron");
const { query } = require("./db");
const { computeStatus, daysBetween, todayStr } = require("./statusUtil");
const { sendMail } = require("./mailer");
const { sendPushToUser } = require("./push");

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

async function buildDigestFor(rows) {
  const overdue = [], atRisk = [], delayed = [];
  rows.forEach((t) => {
    const s = computeStatus(t);
    if (s === "overdue") overdue.push(t);
    else if (s === "at_risk") atRisk.push(t);
    else if (s === "delayed_start") delayed.push(t);
  });
  overdue.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  atRisk.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  delayed.sort((a, b) => new Date(a.planned_start) - new Date(b.planned_start));
  return { overdue, atRisk, delayed };
}

function section(title, list, ownerCol) {
  if (!list.length) return `<h3>${title}</h3><p style="color:#888;">None — nice work.</p>`;
  const rows = list.map((t) => {
    let extra = "";
    if (title.startsWith("OVERDUE")) extra = `${Math.abs(daysBetween(todayStr(), t.due_date))}d late`;
    else if (title.startsWith("DUE SOON")) extra = fmtDate(t.due_date);
    else extra = `since ${fmtDate(t.planned_start)}`;
    return `<tr><td>${esc(t.description)}</td><td>${esc(t.entity || "")}</td>` +
      (ownerCol ? `<td>${esc(t.owner_name || "")}</td>` : "") + `<td>${esc(extra)}</td></tr>`;
  }).join("");
  return `<h3>${title}</h3><table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px;">
    <tr style="background:#f0f0f0;"><th align="left">Task</th><th align="left">Entity</th>` +
    (ownerCol ? `<th align="left">Owner</th>` : "") + `<th align="left"></th></tr>${rows}</table>`;
}
function esc(s) { return String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

async function runManagerDigest() {
  const { rows: manager } = await query("SELECT * FROM users WHERE role='manager' LIMIT 1");
  if (!manager[0]) return;
  const { rows } = await query(
    "SELECT t.*, u.name AS owner_name FROM tasks t JOIN users u ON u.id=t.owner_user_id"
  );
  const { overdue, atRisk, delayed } = await buildDigestFor(rows);
  const total = overdue.length + atRisk.length + delayed.length;

  const headline = `HSE Task Tracker — ${overdue.length} overdue, ${atRisk.length} due soon, ${delayed.length} not yet started (as of ${fmtDate(new Date())}).`;
  if (total === 0) {
    await sendMail({ to: manager[0].email, subject: headline, html: `<p>${headline}</p><p><a href="${process.env.APP_BASE_URL}">Open the tracker</a></p>` });
  } else {
    const html = `<p>${headline}</p>
      ${section("OVERDUE", overdue, true)}
      ${section("DUE SOON (within 3 days)", atRisk, true)}
      ${section("NOT YET STARTED (past planned start)", delayed, true)}
      <p><a href="${process.env.APP_BASE_URL}">Open the tracker</a></p>`;
    await sendMail({ to: manager[0].email, subject: headline, html });
  }
  await sendPushToUser(manager[0].id, {
    title: "HSE Task Tracker — daily summary",
    body: `${overdue.length} overdue, ${atRisk.length} due soon, ${delayed.length} not started`
  });
}

async function runOfficerSummaries() {
  const { rows: officers } = await query("SELECT * FROM users WHERE role='officer' AND status='approved'");
  for (const officer of officers) {
    const { rows } = await query("SELECT * FROM tasks WHERE owner_user_id = $1", [officer.id]);
    const { overdue, atRisk, delayed } = await buildDigestFor(rows);
    const total = overdue.length + atRisk.length + delayed.length;
    if (total === 0) continue;
    await sendPushToUser(officer.id, {
      title: "Your HSE tasks — daily summary",
      body: `${overdue.length} overdue, ${atRisk.length} due soon, ${delayed.length} not started`
    });
  }
}

function start() {
  // 07:00 Asia/Dubai (UTC+4) = 03:00 UTC.
  cron.schedule("0 3 * * *", async () => {
    try {
      await runManagerDigest();
      await runOfficerSummaries();
    } catch (e) {
      console.error("daily digest failed", e);
    }
  }, { timezone: "UTC" });
  console.log("Daily digest scheduled for 03:00 UTC (07:00 Asia/Dubai).");
}

module.exports = { start, runManagerDigest, runOfficerSummaries };
