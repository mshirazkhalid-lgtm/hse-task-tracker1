const webpush = require("web-push");
const { query } = require("./db");

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

async function sendPushToUser(userId, payload) {
  if (!ensureConfigured()) return;
  const { rows } = await query("SELECT id, subscription FROM push_subscriptions WHERE user_id = $1", [userId]);
  const body = JSON.stringify(payload);
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, body);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await query("DELETE FROM push_subscriptions WHERE id = $1", [row.id]);
        } else {
          console.warn("push send failed", e.statusCode, e.message);
        }
      }
    })
  );
}

module.exports = { sendPushToUser, ensureConfigured };
