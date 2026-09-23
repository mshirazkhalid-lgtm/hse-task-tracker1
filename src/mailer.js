const nodemailer = require("nodemailer");

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.MAIL_HOST) {
    console.warn("MAIL_HOST is not set — emails will be logged to the console instead of sent.");
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT) || 587,
    secure: Number(process.env.MAIL_PORT) === 465,
    auth: process.env.MAIL_USER ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS } : undefined
  });
  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[mailer] (no MAIL_HOST configured) would send to ${to}: ${subject}\n${text || ""}`);
    return;
  }
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, " ")
    });
  } catch (e) {
    console.error("Failed to send email to", to, e.message);
  }
}

module.exports = { sendMail };
