const express = require("express");
const crypto = require("crypto");
const { query } = require("./db");
const { sendMail } = require("./mailer");
const { makeDecisionToken } = require("./approvalToken");

const router = express.Router();

const LINK_TTL_MS = 20 * 60 * 1000; // 20 minutes — short-lived since it's a direct login
const RESEND_COOLDOWN_MS = 60 * 1000; // don't let someone spam-send themselves links
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/auth/request-link", async (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  const recent = await query(
    `SELECT id FROM magic_link_tokens
     WHERE lower(email) = $1 AND consumed_at IS NULL AND created_at > now() - interval '60 seconds'
     LIMIT 1`,
    [email]
  );
  if (recent.rows.length) {
    return res.json({ ok: true }); // pretend it worked — avoids leaking timing info, and they already have one en route
  }

  const token = crypto.randomBytes(32).toString("hex");
  await query(
    "INSERT INTO magic_link_tokens (email, token, expires_at) VALUES ($1,$2, now() + interval '20 minutes')",
    [email, token]
  );

  const link = `${process.env.APP_BASE_URL}/auth/magic?token=${token}`;
  await sendMail({
    to: email,
    subject: "Your HSE Task Tracker sign-in link",
    html: `
      <p>Click below to sign in to the HSE Task Tracker. This link works once and expires in 20 minutes.</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#2b5f6e;color:#fff;
        text-decoration:none;border-radius:6px;font-weight:600;">Sign in</a></p>
      <p style="color:#777;font-size:12px;">If you didn't request this, you can ignore this email.</p>
    `
  });

  res.json({ ok: true });
});

router.get("/auth/magic", async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send(renderPage("Missing link", "This sign-in link is incomplete. Please request a new one."));

  const { rows } = await query(
    "SELECT * FROM magic_link_tokens WHERE token = $1",
    [token]
  );
  const record = rows[0];
  if (!record || record.consumed_at || new Date(record.expires_at) < new Date()) {
    return res.status(400).send(renderPage("Link expired", "This sign-in link is invalid or has already been used. Go back to the app and request a new one."));
  }
  await query("UPDATE magic_link_tokens SET consumed_at = now() WHERE id = $1", [record.id]);

  const email = record.email;
  try {
    let { rows: userRows } = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
    let user = userRows[0];

    if (!user) {
      const isManager = email === (process.env.MANAGER_EMAIL || "").toLowerCase();
      const name = email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const inserted = await query(
        `INSERT INTO users (email, name, role, status, approved_at, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          email, name,
          isManager ? "manager" : "pending",
          isManager ? "approved" : "pending",
          isManager ? new Date() : null,
          isManager ? "system" : null
        ]
      );
      user = inserted.rows[0];
      if (!isManager) await notifyManagerOfRequest(user);
    }

    req.session.userId = user.id;
    res.redirect("/");
  } catch (e) {
    console.error("magic link sign-in failed", e);
    res.status(500).send(renderPage("Sign-in failed", "Something went wrong signing you in. Please try requesting a new link."));
  }
});

router.get("/auth/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

async function notifyManagerOfRequest(user) {
  const approveUrl = `${process.env.APP_BASE_URL}/admin/decide?token=${makeDecisionToken(user.id, "approve")}`;
  const denyUrl = `${process.env.APP_BASE_URL}/admin/decide?token=${makeDecisionToken(user.id, "deny")}`;
  await sendMail({
    to: process.env.MANAGER_EMAIL,
    subject: `HSE Tracker — access request from ${user.name}`,
    html: `
      <p><b>${escapeHtml(user.name)}</b> (${escapeHtml(user.email)}) just signed in to the HSE Task Tracker
      and is waiting for your approval before they can use it.</p>
      <p>
        <a href="${approveUrl}" style="display:inline-block;padding:10px 18px;background:#2b5f6e;color:#fff;
          text-decoration:none;border-radius:6px;font-weight:600;margin-right:10px;">Approve</a>
        <a href="${denyUrl}" style="display:inline-block;padding:10px 18px;background:#eee;color:#333;
          text-decoration:none;border-radius:6px;font-weight:600;">Deny</a>
      </p>
      <p style="color:#777;font-size:12px;">You can also review all pending requests any time by signing in
      to the tracker at ${process.env.APP_BASE_URL} and opening "Pending requests".</p>
    `
  });
}

function renderPage(title, message) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} — HSE Task Tracker</title>
    <style>body{font-family:system-ui,sans-serif;background:#f4f6f3;color:#182420;display:flex;
    align-items:center;justify-content:center;height:100vh;margin:0;}
    .box{background:#fff;border:1px solid #dde3da;border-radius:12px;padding:32px 36px;max-width:420px;text-align:center;}
    h1{font-size:18px;margin:0 0 8px;} p{color:#5c6b63;font-size:14px;}
    a{color:#2b5f6e;}</style></head>
    <body><div class="box"><h1>${title}</h1><p>${message}</p><p><a href="/">Back to the app</a></p></div></body></html>`;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = { router, notifyManagerOfRequest };
