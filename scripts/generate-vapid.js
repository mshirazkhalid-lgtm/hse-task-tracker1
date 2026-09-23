// Run once: node scripts/generate-vapid.js
// Copy the two keys it prints into your VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
// environment variables (on Render: Environment tab).
const webpush = require("web-push");
const keys = webpush.generateVAPIDKeys();
console.log("VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
