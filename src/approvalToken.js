const crypto = require("crypto");

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function secret() {
  const s = process.env.APPROVAL_TOKEN_SECRET;
  if (!s) throw new Error("APPROVAL_TOKEN_SECRET is not set");
  return s;
}

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Build a signed, self-contained token for one specific approve/deny decision on one user. */
function makeDecisionToken(userId, decision) {
  return sign({ uid: userId, decision, exp: Date.now() + TOKEN_TTL_MS });
}

/** Returns { uid, decision } if valid and unexpired, otherwise null. */
function verifyDecisionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
  if (!data || Date.now() > data.exp) return null;
  return data;
}

module.exports = { makeDecisionToken, verifyDecisionToken };
