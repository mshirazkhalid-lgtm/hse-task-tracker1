const express = require("express");
const { query } = require("./db");
const { sendMail } = require("./mailer");
const { verifyDecisionToken } = require("./approvalToken");
const { requireAuth, requireManager } = require("./middleware");

const router = express.Router();

async function applyDecision(userId, decision, approvedByName) {
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [userId]);
  const user = rows[0];
  if (!user) return { ok: false, message: "That access request no longer exists." };
  if (user.status !== "pending") {
    return { ok: true, already: true, user, message: `${user.name} was already ${user.status}.` };
  }
  const status = decision === "approve" ? "approved" : "denied";
  const role = decision === "approve" ? "officer" : "pending";
  await query(
    "UPDATE users SET status=$1, role=$2, approved_at=now(), approved_by=$3 WHERE id=$4",
    [status, role, approvedByName || "manager", userId]
  );
  if (decision === "approve") {
    await sendMail({
      to: user.email,
      subject: "You're approved — HSE Task Tracker",
      html: `<p>Hi ${user.name},</p><p>Your access to the HSE Task Tracker has been approved. You can sign in now:</p>
             <p><a href="${process.env.APP_BASE_URL}">${process.env.APP_BASE_URL}</a></p>`
    });
  }
  return { ok: true, user, message: `${user.name} was ${status}.` };
}

// One-click link from the email — no login required, the signed token is the authorization.
router.get("/admin/decide", async (req, res) => {
  const data = verifyDecisionToken(req.query.token);
  if (!data) {
    return res.status(400).send(renderPage("Link expired", "This approval link is invalid or has expired. Please use the in-app Pending requests panel instead."));
  }
  const result = await applyDecision(data.uid, data.decision, "manager (via email)");
  res.send(renderPage(result.already ? "Already handled" : "Done", result.message));
});

// In-app panel — requires the manager to be signed in.
router.get("/api/admin/pending", requireAuth, requireManager, async (req, res) => {
  const { rows } = await query(
    "SELECT id, email, name, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC"
  );
  res.json(rows);
});

router.post("/api/admin/pending/:id/:decision", requireAuth, requireManager, async (req, res) => {
  const decision = req.params.decision === "approve" ? "approve" : "deny";
  const result = await applyDecision(Number(req.params.id), decision, req.user.name);
  res.json(result);
});

function renderPage(title, message) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} — HSE Task Tracker</title>
    <style>body{font-family:system-ui,sans-serif;background:#f4f6f3;color:#182420;display:flex;
    align-items:center;justify-content:center;height:100vh;margin:0;}
    .box{background:#fff;border:1px solid #dde3da;border-radius:12px;padding:32px 36px;max-width:420px;text-align:center;}
    h1{font-size:18px;margin:0 0 8px;} p{color:#5c6b63;font-size:14px;}</style></head>
    <body><div class="box"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

module.exports = { router, applyDecision };
