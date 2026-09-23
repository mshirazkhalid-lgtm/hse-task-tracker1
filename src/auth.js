const express = require("express");
const msal = require("@azure/msal-node");
const { query } = require("./db");
const { sendMail } = require("./mailer");
const { makeDecisionToken } = require("./approvalToken");

const router = express.Router();

function msalClient() {
  return new msal.ConfidentialClientApplication({
    auth: {
      clientId: process.env.MS_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
      clientSecret: process.env.MS_CLIENT_SECRET
    }
  });
}

const SCOPES = ["openid", "profile", "email", "User.Read"];

router.get("/auth/login", async (req, res) => {
  try {
    const url = await msalClient().getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: process.env.MS_REDIRECT_URI
    });
    res.redirect(url);
  } catch (e) {
    console.error(e);
    res.status(500).send("Could not start Microsoft sign-in. Check MS_TENANT_ID / MS_CLIENT_ID configuration.");
  }
});

router.get("/auth/callback", async (req, res) => {
  if (!req.query.code) return res.status(400).send("Missing authorization code.");
  try {
    const result = await msalClient().acquireTokenByCode({
      code: req.query.code,
      scopes: SCOPES,
      redirectUri: process.env.MS_REDIRECT_URI
    });
    const claims = result.idTokenClaims || {};
    const oid = claims.oid || claims.sub;
    const email = (claims.preferred_username || claims.email || "").toLowerCase();
    const name = claims.name || email;

    if (!email) {
      return res.status(400).send("Your Microsoft account did not return an email address — cannot sign you in.");
    }

    let { rows } = await query(
      "SELECT * FROM users WHERE lower(email) = lower($1) OR ms_oid = $2",
      [email, oid]
    );
    let user = rows[0];

    if (!user) {
      const isManager = email === (process.env.MANAGER_EMAIL || "").toLowerCase();
      const inserted = await query(
        `INSERT INTO users (email, name, ms_oid, role, status, approved_at, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          email, name, oid,
          isManager ? "manager" : "pending",
          isManager ? "approved" : "pending",
          isManager ? new Date() : null,
          isManager ? "system" : null
        ]
      );
      user = inserted.rows[0];
      if (!isManager) await notifyManagerOfRequest(user);
    } else if (!user.ms_oid) {
      await query("UPDATE users SET ms_oid=$1, name=$2 WHERE id=$3", [oid, name, user.id]);
      user.ms_oid = oid;
      user.name = name;
    }

    req.session.userId = user.id;
    res.redirect("/");
  } catch (e) {
    console.error("auth callback failed", e);
    res.status(500).send("Sign-in failed. Please try again, or ask your HSE manager to check the app's Microsoft sign-in setup.");
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

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = { router, notifyManagerOfRequest };
