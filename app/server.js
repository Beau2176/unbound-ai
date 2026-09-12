const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = "unbound_session";
const SESSION_DAYS = 30;
const IS_PRODUCTION =
  process.env.NODE_ENV === "production" || process.env.RENDER === "true";
const scryptAsync = promisify(crypto.scrypt);

const UNBOUND_SYSTEM_PROMPT = `
You are UNBOUND AI, the AI assistant inside the UNBOUND AI platform.

UNBOUND AI is an adults-only (18+) AI platform built for candid conversation, broad research, creativity, mature subjects, and user-controlled AI personalities and settings.

UNBOUND AI is designed around a user-first philosophy:
the AI adapts to the user instead of forcing the user to adapt to the AI.

Your behavior:
- Be useful, accurate, direct, natural, and conversational.
- Prefer clear answers over unnecessary boilerplate.
- Separate facts, estimates, predictions, and opinions when that distinction matters.
- Be candid and adult in tone when appropriate.
- Do not misidentify UNBOUND AI as an unrelated company, brand, or generic concept.
- When asked what UNBOUND AI is, describe this platform and its user-first philosophy.
- Respect user choice, settings, privacy, and autonomy.
- Avoid unnecessary refusals.
- Keep firm boundaries around serious illegal harm, exploitation, abuse, minors, trafficking, and non-consensual sexual content.
- Never claim something was completed unless it actually was.
- Protect private information and credentials.

UNBOUND AI brand line:
"A more open tomorrow starts today."
`;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.get("/index.html", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin.html", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/unbound-cosmic.png", (req, res) => res.sendFile(path.join(__dirname, "unbound-cosmic.png")));

let pool = null;
let databaseReady = false;
let databaseError = null;

function createPool() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function cleanDisplayName(value, email) {
  const displayName = typeof value === "string" ? value.trim() : "";
  const fallback = email.split("@")[0] || "UNBOUND User";
  return (displayName || fallback).slice(0, 60);
}

async function initializeDatabase() {
  pool = createPool();

  if (!pool) {
    databaseError = "DATABASE_URL is not configured.";
    console.log(
      "UNBOUND AI database not connected: DATABASE_URL is not configured."
    );
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      plan_tier TEXT NOT NULL DEFAULT 'free',
      adult_confirmed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx
      ON user_sessions(user_id);

    CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx
      ON user_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS complimentary_top_tier_grants (
      slot SMALLINT PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT complimentary_slot_check CHECK (slot BETWEEN 1 AND 5)
    );
  `);

  const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);

  if (ownerEmail) {
    await pool.query(
      `UPDATE users
       SET role = 'admin',
           plan_tier = 'top',
           updated_at = NOW()
       WHERE email = $1`,
      [ownerEmail]
    );
  }

  databaseReady = true;
  databaseError = null;
  console.log("UNBOUND AI database connected and account tables are ready.");
}

initializeDatabase().catch((error) => {
  databaseReady = false;
  databaseError = error.message;
  console.error("UNBOUND AI DATABASE ERROR:", error);
});

function requireDatabase(req, res, next) {
  if (!databaseReady || !pool) {
    return res.status(503).json({
      error: "Account system is not connected to the database yet."
    });
  }

  next();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, keyHex] = String(storedHash || "").split(":");

  if (!salt || !keyHex) {
    return false;
  }

  const derivedKey = await scryptAsync(password, salt, 64);
  const storedKey = Buffer.from(keyHex, "hex");

  if (storedKey.length !== derivedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedKey, derivedKey);
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  }

  return cookies;
}

function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secure = IS_PRODUCTION ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = IS_PRODUCTION ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

async function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);

  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`,
    [userId, tokenHash]
  );

  setSessionCookie(res, token);
}

async function findSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];

  if (!token || !databaseReady || !pool) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const result = await pool.query(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.role,
       u.plan_tier,
       u.adult_confirmed_at,
       u.created_at,
       EXISTS (
         SELECT 1
         FROM complimentary_top_tier_grants g
         WHERE g.user_id = u.id
       ) AS complimentary_top_tier
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  return result.rows[0] || null;
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: String(user.id),
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    planTier: user.plan_tier,
    complimentaryTopTier: Boolean(user.complimentary_top_tier),
    createdAt: user.created_at
  };
}

async function requireAdmin(req, res, next) {
  try {
    const user = await findSessionUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Sign in with an administrator account."
      });
    }

    if (user.role !== "admin") {
      return res.status(403).json({
        error: "Administrator access is required."
      });
    }

    req.adminUser = user;
    next();
  } catch (error) {
    console.error("UNBOUND AI ADMIN AUTH ERROR:", error);
    return res.status(500).json({
      error: "Could not verify administrator access."
    });
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    database: databaseReady ? "connected" : "not-connected",
    accounts: databaseReady ? "ready" : "not-ready"
  });
});

app.post("/api/auth/register", requireDatabase, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    const adultConfirmed = req.body.adultConfirmed === true;
    const displayName = cleanDisplayName(req.body.displayName, email);

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    if (password.length < 12 || password.length > 200) {
      return res.status(400).json({
        error: "Password must be between 12 and 200 characters."
      });
    }

    if (!adultConfirmed) {
      return res.status(400).json({
        error:
          "You must confirm that you are 18 or older to create an UNBOUND AI account."
      });
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (
         email,
         password_hash,
         display_name,
         adult_confirmed_at
       )
       VALUES ($1, $2, $3, NOW())
       RETURNING id, email, display_name, role, plan_tier,
                 adult_confirmed_at, created_at`,
      [email, passwordHash, displayName]
    );

    const user = {
      ...result.rows[0],
      complimentary_top_tier: false
    };

    await createSession(user.id, res);

    return res.status(201).json({
      user: publicUser(user)
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "An account with that email already exists."
      });
    }

    console.error("UNBOUND AI REGISTER ERROR:", error);
    return res.status(500).json({ error: "Account creation failed." });
  }
});

app.post("/api/auth/login", requireDatabase, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    const result = await pool.query(
      `SELECT id, email, password_hash, display_name, role, plan_tier,
              adult_confirmed_at, created_at
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email]
    );

    const user = result.rows[0];
    const passwordMatches = user
      ? await verifyPassword(password, user.password_hash)
      : false;

    if (!user || !passwordMatches) {
      return res.status(401).json({
        error: "Email or password is incorrect."
      });
    }

    await createSession(user.id, res);

    const grantResult = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM complimentary_top_tier_grants
         WHERE user_id = $1
       ) AS complimentary_top_tier`,
      [user.id]
    );

    user.complimentary_top_tier =
      grantResult.rows[0].complimentary_top_tier;

    return res.json({
      user: publicUser(user)
    });
  } catch (error) {
    console.error("UNBOUND AI LOGIN ERROR:", error);
    return res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/auth/logout", requireDatabase, async (req, res) => {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];

    if (token) {
      await pool.query(
        "DELETE FROM user_sessions WHERE token_hash = $1",
        [hashSessionToken(token)]
      );
    }

    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    console.error("UNBOUND AI LOGOUT ERROR:", error);
    clearSessionCookie(res);
    return res.json({ ok: true });
  }
});

app.get("/api/auth/me", requireDatabase, async (req, res) => {
  try {
    const user = await findSessionUser(req);

    if (!user) {
      return res.status(401).json({ user: null });
    }

    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error("UNBOUND AI SESSION ERROR:", error);
    return res.status(500).json({ error: "Could not load account." });
  }
});

/* ----------------------------- ADMIN API ----------------------------- */

app.get(
  "/api/admin/overview",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          u.id,
          u.email,
          u.display_name,
          u.role,
          u.plan_tier,
          u.created_at,
          g.slot AS complimentary_slot,
          g.granted_at AS complimentary_granted_at
        FROM users u
        LEFT JOIN complimentary_top_tier_grants g
          ON g.user_id = u.id
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT 500
      `);

      const users = result.rows.map((user) => ({
        id: String(user.id),
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        planTier: user.plan_tier,
        complimentarySlot:
          user.complimentary_slot === null
            ? null
            : Number(user.complimentary_slot),
        complimentaryGrantedAt: user.complimentary_granted_at,
        createdAt: user.created_at
      }));

      const slotMap = new Map(
        users
          .filter((user) => user.complimentarySlot !== null)
          .map((user) => [user.complimentarySlot, user])
      );

      const giftSlots = [1, 2, 3, 4, 5].map((slot) => {
        const user = slotMap.get(slot);

        return {
          slot,
          user: user
            ? {
                id: user.id,
                email: user.email,
                displayName: user.displayName
              }
            : null
        };
      });

      return res.json({
        admin: publicUser(req.adminUser),
        ownerEmail: normalizeEmail(process.env.OWNER_EMAIL),
        totals: {
          users: users.length,
          topTier: users.filter((user) => user.planTier === "top").length,
          complimentaryUsed: giftSlots.filter((item) => item.user).length,
          complimentaryAvailable: giftSlots.filter((item) => !item.user).length
        },
        giftSlots,
        users
      });
    } catch (error) {
      console.error("UNBOUND AI ADMIN OVERVIEW ERROR:", error);
      return res.status(500).json({
        error: "Could not load the admin dashboard."
      });
    }
  }
);

app.patch(
  "/api/admin/users/:id/plan",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const userId = String(req.params.id || "").trim();
      const planTier =
        typeof req.body.planTier === "string"
          ? req.body.planTier.trim().toLowerCase()
          : "";

      if (!/^\d+$/.test(userId)) {
        return res.status(400).json({ error: "Invalid user ID." });
      }

      if (!["free", "top"].includes(planTier)) {
        return res.status(400).json({
          error: "Plan must be FREE or TOP."
        });
      }

      const targetResult = await pool.query(
        `SELECT id, email, role, plan_tier
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [userId]
      );

      const target = targetResult.rows[0];

      if (!target) {
        return res.status(404).json({ error: "User not found." });
      }

      const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);

      if (normalizeEmail(target.email) === ownerEmail && planTier !== "top") {
        return res.status(400).json({
          error: "The owner account must remain on the TOP plan."
        });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        if (planTier !== "top") {
          await client.query(
            "DELETE FROM complimentary_top_tier_grants WHERE user_id = $1",
            [userId]
          );
        }

        const updateResult = await client.query(
          `UPDATE users
           SET plan_tier = $1,
               updated_at = NOW()
           WHERE id = $2
           RETURNING id, email, display_name, role, plan_tier, created_at`,
          [planTier, userId]
        );

        await client.query("COMMIT");

        return res.json({
          user: {
            id: String(updateResult.rows[0].id),
            email: updateResult.rows[0].email,
            displayName: updateResult.rows[0].display_name,
            role: updateResult.rows[0].role,
            planTier: updateResult.rows[0].plan_tier,
            createdAt: updateResult.rows[0].created_at
          }
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("UNBOUND AI ADMIN PLAN ERROR:", error);
      return res.status(500).json({
        error: "Could not update that user's plan."
      });
    }
  }
);

app.post(
  "/api/admin/complimentary/grant",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);

      if (!isValidEmail(email)) {
        return res.status(400).json({
          error: "Enter the email address of an existing UNBOUND AI account."
        });
      }

      const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);

      if (email === ownerEmail) {
        return res.status(400).json({
          error: "The owner account already has permanent TOP access."
        });
      }

      const userResult = await pool.query(
        `SELECT id, email, display_name, role, plan_tier
         FROM users
         WHERE email = $1
         LIMIT 1`,
        [email]
      );

      const user = userResult.rows[0];

      if (!user) {
        return res.status(404).json({
          error:
            "That email does not have an UNBOUND AI account yet. Have them create an account first."
        });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "LOCK TABLE complimentary_top_tier_grants IN SHARE ROW EXCLUSIVE MODE"
        );

        const existingResult = await client.query(
          `SELECT slot
           FROM complimentary_top_tier_grants
           WHERE user_id = $1
           LIMIT 1`,
          [user.id]
        );

        if (existingResult.rows[0]) {
          await client.query("COMMIT");
          return res.json({
            ok: true,
            alreadyGranted: true,
            slot: Number(existingResult.rows[0].slot),
            user: {
              id: String(user.id),
              email: user.email,
              displayName: user.display_name
            }
          });
        }

        const slotResult = await client.query(`
          SELECT slot
          FROM generate_series(1, 5) AS available(slot)
          WHERE NOT EXISTS (
            SELECT 1
            FROM complimentary_top_tier_grants g
            WHERE g.slot = available.slot
          )
          ORDER BY slot
          LIMIT 1
        `);

        if (!slotResult.rows[0]) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error:
              "All five complimentary TOP-tier gift slots are already assigned."
          });
        }

        const slot = Number(slotResult.rows[0].slot);

        await client.query(
          `INSERT INTO complimentary_top_tier_grants (slot, user_id)
           VALUES ($1, $2)`,
          [slot, user.id]
        );

        await client.query(
          `UPDATE users
           SET plan_tier = 'top',
               updated_at = NOW()
           WHERE id = $1`,
          [user.id]
        );

        await client.query("COMMIT");

        return res.status(201).json({
          ok: true,
          slot,
          user: {
            id: String(user.id),
            email: user.email,
            displayName: user.display_name
          }
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error: "That complimentary slot could not be assigned. Try again."
        });
      }

      console.error("UNBOUND AI ADMIN GIFT ERROR:", error);
      return res.status(500).json({
        error: "Could not grant complimentary TOP-tier access."
      });
    }
  }
);

app.delete(
  "/api/admin/complimentary/:userId",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const userId = String(req.params.userId || "").trim();

      if (!/^\d+$/.test(userId)) {
        return res.status(400).json({ error: "Invalid user ID." });
      }

      const targetResult = await pool.query(
        `SELECT id, email, role
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [userId]
      );

      const target = targetResult.rows[0];

      if (!target) {
        return res.status(404).json({ error: "User not found." });
      }

      const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);

      if (normalizeEmail(target.email) === ownerEmail) {
        return res.status(400).json({
          error: "The owner account cannot use a complimentary gift slot."
        });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const deleted = await client.query(
          `DELETE FROM complimentary_top_tier_grants
           WHERE user_id = $1
           RETURNING slot`,
          [userId]
        );

        if (!deleted.rows[0]) {
          await client.query("ROLLBACK");
          return res.status(404).json({
            error: "That user does not currently have a complimentary slot."
          });
        }

        if (target.role !== "admin") {
          await client.query(
            `UPDATE users
             SET plan_tier = 'free',
                 updated_at = NOW()
             WHERE id = $1`,
            [userId]
          );
        }

        await client.query("COMMIT");

        return res.json({
          ok: true,
          slot: Number(deleted.rows[0].slot)
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("UNBOUND AI ADMIN REVOKE ERROR:", error);
      return res.status(500).json({
        error: "Could not revoke complimentary TOP-tier access."
      });
    }
  }
);

/* ----------------------------- CHAT API ------------------------------ */

function cleanHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => {
      return (
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim()
      );
    })
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 12000)
    }))
    .slice(-20);
}

app.post("/api/chat", async (req, res) => {
  try {
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!message) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is not loaded."
      });
    }

    const OpenAI = (await import("openai")).default;

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const history = cleanHistory(req.body.history);

    const input = [
      ...history,
      {
        role: "user",
        content: message.slice(0, 12000)
      }
    ];

    const response = await client.responses.create({
      model: "gpt-5.6-luna",
      instructions: UNBOUND_SYSTEM_PROMPT,
      input
    });

    res.json({
      reply: response.output_text
    });
  } catch (error) {
    console.error("UNBOUND AI ERROR:", error);

    res.status(500).json({
      error: error.message || "UNBOUND AI could not get a response."
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`UNBOUND AI running on port ${PORT}`);
});
