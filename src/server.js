require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);

const db = require("./db");
const { router: authRouter } = require("./auth");
const { router: approvalRouter } = require("./approval");
const { router: tasksRouter } = require("./tasks");
const { requireAuth } = require("./middleware");
const digest = require("./digest");

const REQUIRED_ENV = ["DATABASE_URL", "SESSION_SECRET", "APPROVAL_TOKEN_SECRET", "APP_BASE_URL", "MANAGER_EMAIL", "MAIL_HOST"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing required environment variables:", missing.join(", "));
  console.error("Copy .env.example to .env (locally) or set these in your host's dashboard, then restart.");
  process.exit(1);
}

async function main() {
  await db.init();

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(
    session({
      store: new pgSession({ pool: db.pool, tableName: "session", createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: process.env.APP_BASE_URL.startsWith("https"), maxAge: 30 * 24 * 60 * 60 * 1000 }
    })
  );

  app.use(authRouter);
  app.use(approvalRouter);
  app.use(tasksRouter);

  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  digest.start();

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`HSE Task Tracker listening on port ${port}`));
}

main().catch((e) => {
  console.error("Fatal startup error:", e);
  process.exit(1);
});
