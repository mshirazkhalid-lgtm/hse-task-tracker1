const { query } = require("./db");

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "not_signed_in" });
  }
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
  if (!rows[0]) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "not_signed_in" });
  }
  req.user = rows[0];
  next();
}

function requireApproved(req, res, next) {
  if (req.user.status !== "approved") {
    return res.status(403).json({ error: "not_approved", status: req.user.status });
  }
  next();
}

function requireManager(req, res, next) {
  if (req.user.role !== "manager") {
    return res.status(403).json({ error: "manager_only" });
  }
  next();
}

module.exports = { requireAuth, requireApproved, requireManager };
