const express = require("express");
const compression = require("compression");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const { Pool } = require("pg");
const { generateChat, streamChat, getGatewayStatus } = require("./ai/gateway");
const {
  CAPABILITY_CATALOG,
  normalizePlanTier,
  getPlanDefinition,
  isKnownCapability,
  buildCapabilityAccess
} = require("./access/entitlements");
const {
  normalizeSubscriptionStatus,
  subscriptionStatusAllowsAccess,
  getBillingGatewayStatus,
  startBillingCheckoutSession,
  startBillingCustomerPortalSession,
  processBillingWebhook
} = require("./billing/gateway");
const {
  advertisingPackages,
  getAdvertisingPackage,
  normalizeAdvertisingCreative
} = require("./advertising/catalog");
const {
  getAdvertisingPaymentStatus,
  startAdvertisingCheckout,
  processAdvertisingWebhook
} = require("./advertising/gateway");
const {
  normalizeAgeVerificationStatus,
  ageVerificationAllowsAdultAccess,
  getAgeVerificationGatewayStatus,
  startAgeVerificationSession,
  processAgeVerificationWebhook,
  resolveAgeVerificationTransition
} = require("./age/gateway");
const {
  getRateLimitPolicy,
  hashRateLimitSubject,
  getRateLimitStatus
} = require("./security/rate-limit");
const {
  createHttpSecurityMiddleware,
  createSameOriginApiGuard,
  getHttpSecurityStatus
} = require("./security/http-security");
const {
  getPasskeyConfig,
  getPasskeyStatus,
  generateRegistration,
  verifyRegistration,
  generateAuthentication,
  verifyAuthentication
} = require("./security/passkeys");
const {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCode,
  isRecoveryCodeShape,
  getRecoveryStatus
} = require("./security/recovery");
const {
  normalizeAlertSeverity,
  buildNewDeviceAlert,
  getSecurityAlertStatus
} = require("./security/alerts");
const {
  getSignInRiskConfig,
  buildRepeatedFailureAlert,
  getSignInRiskStatus
} = require("./security/signin-risk");
const {
  normalizeAiStyle,
  getAiStylePrompt,
  listAiStyles
} = require("./preferences/ai-style");
const {
  buildExportFilename,
  buildDataExport
} = require("./privacy/data-export");
const {
  publicDeletionBlock
} = require("./privacy/account-deletion");
const {
  normalizeLegalDocumentType,
  getLegalDocumentCatalog,
  legalPublishingState,
  buildLegalConsentStatus
} = require("./privacy/legal-consent");
const {
  buildLivenessStatus,
  buildReadinessStatus
} = require("./ops/runtime-status");
const {
  getDatabaseResilienceConfig,
  databaseRetryDelay
} = require("./ops/database-resilience");
const { buildRecoveryReadiness } = require("./ops/recovery-readiness");
const {
  getMaintenanceStatus,
  createMaintenanceMiddleware
} = require("./ops/maintenance-mode");
const {
  getRequestObservabilitySnapshot,
  createRequestObservabilityMiddleware
} = require("./ops/request-observability");
const { buildInfrastructureReadiness } = require("./ops/infrastructure-readiness");
const { buildLaunchReadiness } = require("./ops/launch-readiness");

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = "unbound_session";
const SESSION_DAYS = 30;
const DEVICE_COOKIE = "unbound_device";
const DEVICE_DAYS = 365;
const GUEST_RATE_COOKIE = "unbound_guest_rate";
const GUEST_RATE_DAYS = 1;
const PASSKEY_FLOW_COOKIE = "unbound_passkey_flow";
const AGE_VERIFICATION_WEBHOOK_PATH = "/api/webhooks/age-verification";
const BILLING_WEBHOOK_PATH = "/api/webhooks/billing";
const ADVERTISING_WEBHOOK_PATH = "/api/webhooks/advertising";
const RAW_WEBHOOK_PATHS = new Set([
  AGE_VERIFICATION_WEBHOOK_PATH,
  BILLING_WEBHOOK_PATH,
  ADVERTISING_WEBHOOK_PATH
]);
const RATE_LIMIT_POLICY = getRateLimitPolicy();
const SIGNIN_RISK_CONFIG = getSignInRiskConfig();
const RATE_LIMIT_SECRET =
  process.env.RATE_LIMIT_HASH_SECRET ||
  process.env.DATABASE_URL ||
  crypto.randomBytes(32).toString("hex");
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

const CASUAL_DEPTH_PROMPT = `
Response-depth style: CASUAL MODE.
- Prioritize speed and give a concise, direct answer first.
- Avoid unnecessary detail, repetition, lengthy analysis, or extra steps.
- State uncertainty clearly when it materially affects the answer.
- If deeper analysis, verification, or research would improve the answer, say so briefly and let the user choose to go deeper.
- Never claim to have researched, browsed, verified, or used a tool unless that actually happened.
`;

const WORK_DEPTH_PROMPT = `
Response-depth style: WORK MODE.
- Analyze the request thoroughly before answering.
- Work through reasonable intermediate steps and produce a complete, organized response.
- Compare relevant options when useful.
- Clearly separate established facts, estimates, recommendations, predictions, and uncertainty when those distinctions matter.
- Do not stop at a shallow first answer when a deeper treatment is useful.
- Use external research only when research tools are actually provided for the current request. Never claim browsing, verification, or tool use unless it actually occurred.
`;

const RESEARCH_MODE_PROMPT = `
Product mode: RESEARCH MODE.
- Use the provided web-search capability before answering.
- Prefer primary, official, recent, and directly relevant sources when they are available.
- Cross-check important or disputed claims across more than one source when practical.
- Clearly distinguish verified facts, uncertainty, estimates, and interpretation.
- Do not invent sources, citations, quotes, dates, or claims that were not supported by the research.
- Keep citations attached to the claims they support. The user interface will make cited URLs visible and clickable.
`;

const CREATIVE_MODE_PROMPT = `
Product mode: CREATIVE MODE.
- Prioritize useful imagination, originality, and collaborative creation while following the user's requested format and constraints.
- Help with brainstorming, fiction, scripts, concepts, names, worldbuilding, marketing concepts, roleplay scenarios, and creative problem-solving.
- When the user asks for alternatives, produce meaningfully different options rather than superficial rewrites.
- Preserve continuity, characters, tone, facts, and constraints established in the conversation unless the user asks to change them.
- Do not present invented details as verified real-world facts. Clearly distinguish creative invention from factual claims when the boundary matters.
- Do not claim web research or source verification unless a real research capability was actually invoked.
`;

const UNBOUND_MODE_PROMPT = `
Product mode: UNBOUND MODE.
- Be especially candid, direct, and natural. Answer the user's actual question instead of burying the answer under unnecessary caveats or boilerplate.
- Discuss mature, controversial, uncomfortable, or unconventional subjects frankly when they can be discussed safely.
- Match the user's preferred level of formality and language, including profanity when it naturally fits the conversation.
- Prefer useful substance over moralizing, lecturing, or needless repetition.
- Do not confuse candor with certainty: clearly state meaningful uncertainty, estimates, and factual limits.
- Keep the platform's core safety boundaries around serious illegal harm, exploitation, abuse, minors, trafficking, and non-consensual sexual content.
- Never claim tools, browsing, verification, or real-world actions that did not actually occur.
`;

const ADULT_MODE_PROMPT = `
Product mode: ADULT MODE.
- This mode is available only after the server has confirmed hard 18+ age verification for the signed-in account.
- Discuss lawful adult relationships, sexuality, sexual health, dating, mature fiction, and other adult subjects candidly and without unnecessary euphemism when relevant to the user's request.
- Treat all sexual or romantic participants as adults. Never sexualize minors or people whose age is ambiguous.
- Keep firm boundaries around exploitation, trafficking, coercion, non-consensual sexual content, serious illegal harm, and abuse.
- For medical, legal, or other high-stakes adult topics, clearly distinguish general information from personalized professional advice.
- Do not claim that age verification occurred because of the conversation; the server-side gate is the authority for access to this mode.
- Never claim tools, browsing, verification, or real-world actions that did not actually occur.
`;

app.disable("x-powered-by");
app.use(createRequestObservabilityMiddleware());
app.use(createHttpSecurityMiddleware({ isProduction: IS_PRODUCTION }));
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.path === "/api/chat/stream") return false;
      return compression.filter(req, res);
    }
  })
);
app.use(
  createSameOriginApiGuard({
    isProduction: IS_PRODUCTION,
    publicOrigin: process.env.PUBLIC_APP_ORIGIN || "",
    exemptPaths: [AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH, ADVERTISING_WEBHOOK_PATH]
  })
);
for (const webhookPath of RAW_WEBHOOK_PATHS) {
  app.use(webhookPath, express.raw({ type: "*/*", limit: "100kb" }));
}
const jsonBodyParser = express.json({ limit: "100kb" });
app.use((req, res, next) => {
  if (RAW_WEBHOOK_PATHS.has(req.path)) return next();
  return jsonBodyParser(req, res, next);
});
app.use("/api", createMaintenanceMiddleware());
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.get("/index.html", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/admin.html", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "admin.html"));
});
app.get("/terms.html", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "terms.html"));
});
app.get("/privacy.html", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "privacy.html"));
});
app.get("/advertisers.html", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "advertisers.html"));
});
app.get("/advertising-admin", requireDatabase, requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "advertising-admin.html"));
});
app.get("/unbound-cosmic.png", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  return res.sendFile(path.join(__dirname, "unbound-cosmic.png"));
});

let pool = null;
let databaseReady = false;
let databaseError = null;
let databaseInitializing = false;
let databaseInitAttempt = 0;
let databaseRetryTimer = null;
let shuttingDown = false;
const DATABASE_RESILIENCE = getDatabaseResilienceConfig();

function sendStatusJson(res, statusCode, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(statusCode).json(payload);
}

app.get("/healthz", (req, res) => {
  return sendStatusJson(res, 200, buildLivenessStatus());
});

app.get("/readyz", (req, res) => {
  const payload = buildReadinessStatus({
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseReady,
    databaseError,
    shuttingDown,
    maintenanceStatus: getMaintenanceStatus(),
    aiStatus: getGatewayStatus()
  });

  return sendStatusJson(res, payload.ready ? 200 : 503, payload);
});

app.get("/api/system/status", (req, res) => {
  const payload = buildReadinessStatus({
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseReady,
    databaseError,
    shuttingDown,
    maintenanceStatus: getMaintenanceStatus(),
    aiStatus: getGatewayStatus()
  });

  return sendStatusJson(res, payload.ready ? 200 : 503, payload);
});

function createPool() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const nextPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: DATABASE_RESILIENCE.connectionTimeoutMillis,
    statement_timeout: DATABASE_RESILIENCE.statementTimeoutMillis,
    query_timeout: DATABASE_RESILIENCE.queryTimeoutMillis,
    lock_timeout: DATABASE_RESILIENCE.lockTimeoutMillis,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    application_name: "unbound-ai"
  });

  nextPool.on("error", (error) => {
    databaseReady = false;
    databaseError = error?.message || "Database pool connection failed.";
    console.error("UNBOUND AI DATABASE POOL ERROR:", error);
    scheduleDatabaseInitialization("pool-error");
  });

  return nextPool;
}

async function closePoolQuietly(targetPool) {
  if (!targetPool) return;
  try {
    await targetPool.end();
  } catch (error) {
    console.warn("UNBOUND AI DATABASE POOL CLOSE WARNING:", error?.message || error);
  }
}

function scheduleDatabaseInitialization(reason = "retry") {
  if (
    shuttingDown ||
    !process.env.DATABASE_URL ||
    databaseRetryTimer ||
    databaseInitializing
  ) {
    return;
  }

  const delay = databaseRetryDelay(databaseInitAttempt || 1, DATABASE_RESILIENCE);
  console.warn(
    `UNBOUND AI database retry scheduled in ${delay}ms (${reason}).`
  );

  databaseRetryTimer = setTimeout(() => {
    databaseRetryTimer = null;
    void initializeDatabaseWithRetry();
  }, delay);
  databaseRetryTimer.unref?.();
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
  const previousPool = pool;
  pool = null;
  await closePoolQuietly(previousPool);

  pool = createPool();

  if (!pool) {
    databaseError = "DATABASE_URL is not configured.";
    console.log(
      "UNBOUND AI database not connected: DATABASE_URL is not configured."
    );
    return;
  }

  await pool.query("SELECT 1");
  console.log("UNBOUND AI database connection verified; applying schema checks.");

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

    CREATE TABLE IF NOT EXISTS user_ai_preferences (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ai_style TEXT NOT NULL DEFAULT 'balanced',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    CREATE TABLE IF NOT EXISTS account_devices (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_token_hash TEXT NOT NULL,
      device_label TEXT NOT NULL DEFAULT 'Unknown device',
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, device_token_hash)
    );

    CREATE INDEX IF NOT EXISTS account_devices_user_active_idx
      ON account_devices(user_id, revoked_at, last_seen_at DESC);

    ALTER TABLE user_sessions
      ADD COLUMN IF NOT EXISTS device_id BIGINT REFERENCES account_devices(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS user_sessions_device_id_idx
      ON user_sessions(device_id);

    CREATE TABLE IF NOT EXISTS account_security_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id BIGINT REFERENCES account_devices(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS account_security_events_user_created_idx
      ON account_security_events(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS account_security_alerts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id BIGINT REFERENCES account_devices(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      acknowledged_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT account_security_alerts_severity_check
        CHECK (severity IN ('info', 'warning', 'critical'))
    );

    CREATE INDEX IF NOT EXISTS account_security_alerts_user_created_idx
      ON account_security_alerts(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS account_security_alerts_user_unread_idx
      ON account_security_alerts(user_id, acknowledged_at, created_at DESC);

    CREATE TABLE IF NOT EXISTS account_passkey_user_handles (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      user_handle BYTEA NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS account_passkeys (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key BYTEA NOT NULL,
      signature_counter BIGINT NOT NULL DEFAULT 0,
      transports JSONB NOT NULL DEFAULT '[]'::jsonb,
      device_type TEXT,
      backed_up BOOLEAN NOT NULL DEFAULT FALSE,
      label TEXT NOT NULL DEFAULT 'Passkey',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS account_passkeys_user_created_idx
      ON account_passkeys(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS passkey_challenges (
      flow_token_hash TEXT PRIMARY KEY,
      ceremony TEXT NOT NULL,
      challenge TEXT NOT NULL,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT passkey_challenges_ceremony_check
        CHECK (ceremony IN ('registration', 'authentication'))
    );

    CREATE INDEX IF NOT EXISTS passkey_challenges_expires_idx
      ON passkey_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS account_recovery_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS account_recovery_codes_user_active_idx
      ON account_recovery_codes(user_id, used_at, created_at DESC);

    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      scope TEXT NOT NULL,
      subject_hash TEXT NOT NULL,
      subject_kind TEXT NOT NULL,
      window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scope, subject_hash)
    );

    CREATE INDEX IF NOT EXISTS rate_limit_buckets_updated_idx
      ON rate_limit_buckets(updated_at DESC);

    CREATE TABLE IF NOT EXISTS rate_limit_blocks (
      id BIGSERIAL PRIMARY KEY,
      scope TEXT NOT NULL,
      subject_kind TEXT NOT NULL,
      request_count INTEGER NOT NULL,
      limit_count INTEGER NOT NULL,
      window_seconds INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS rate_limit_blocks_created_idx
      ON rate_limit_blocks(created_at DESC);

    CREATE INDEX IF NOT EXISTS rate_limit_blocks_scope_idx
      ON rate_limit_blocks(scope, created_at DESC);



    CREATE TABLE IF NOT EXISTS conversations (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New chat',
      depth_style TEXT NOT NULL DEFAULT 'casual',
      product_mode TEXT NOT NULL DEFAULT 'standard',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT conversations_depth_style_check CHECK (depth_style IN ('casual', 'work'))
    );

    ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS product_mode TEXT NOT NULL DEFAULT 'standard';

    CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
      ON conversations(user_id, updated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      research_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
      research_citations JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT conversation_messages_role_check CHECK (role IN ('user', 'assistant'))
    );

    ALTER TABLE conversation_messages
      ADD COLUMN IF NOT EXISTS research_sources JSONB NOT NULL DEFAULT '[]'::jsonb;

    ALTER TABLE conversation_messages
      ADD COLUMN IF NOT EXISTS research_citations JSONB NOT NULL DEFAULT '[]'::jsonb;

    CREATE INDEX IF NOT EXISTS conversation_messages_conversation_id_idx
      ON conversation_messages(conversation_id, id);


    CREATE TABLE IF NOT EXISTS account_legal_acceptances (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      document_version TEXT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT account_legal_acceptances_type_check
        CHECK (document_type IN ('terms', 'privacy')),
      UNIQUE(user_id, document_type, document_version)
    );

    CREATE INDEX IF NOT EXISTS account_legal_acceptances_user_idx
      ON account_legal_acceptances(user_id, document_type, accepted_at DESC);

    CREATE TABLE IF NOT EXISTS account_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT,
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'none',
      plan_tier TEXT NOT NULL DEFAULT 'free',
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE account_subscriptions
      ADD COLUMN IF NOT EXISTS billing_subject_hash TEXT;

    ALTER TABLE account_subscriptions
      ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;

    CREATE UNIQUE INDEX IF NOT EXISTS account_subscriptions_provider_subject_idx
      ON account_subscriptions(provider, billing_subject_hash)
      WHERE billing_subject_hash IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS account_subscriptions_provider_subscription_idx
      ON account_subscriptions(provider, provider_subscription_id)
      WHERE provider_subscription_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS account_subscriptions_status_idx
      ON account_subscriptions(status, plan_tier);

    CREATE TABLE IF NOT EXISTS billing_webhook_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      event_type TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      payload_sha256 TEXT NOT NULL,
      error_text TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      UNIQUE(provider, provider_event_id)
    );

    CREATE INDEX IF NOT EXISTS billing_webhook_events_received_idx
      ON billing_webhook_events(received_at DESC);

    CREATE INDEX IF NOT EXISTS billing_webhook_events_provider_status_idx
      ON billing_webhook_events(provider, status, received_at DESC);

    CREATE TABLE IF NOT EXISTS advertising_orders (
      id BIGSERIAL PRIMARY KEY,
      subject_hash TEXT NOT NULL UNIQUE,
      package_code TEXT NOT NULL,
      package_name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      currency TEXT NOT NULL CHECK (char_length(currency) = 3),
      duration_days SMALLINT NOT NULL CHECK (duration_days > 0),
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      business_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      website_url TEXT NOT NULL,
      headline TEXT NOT NULL,
      description TEXT NOT NULL,
      payment_provider TEXT,
      payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending','paid','failed','canceled','refunded')),
      review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending','approved','rejected')),
      reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      last_event_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS advertising_orders_public_idx
      ON advertising_orders(payment_status, review_status, featured DESC, ends_at);

    CREATE INDEX IF NOT EXISTS advertising_orders_admin_idx
      ON advertising_orders(review_status, payment_status, created_at DESC);

    CREATE TABLE IF NOT EXISTS advertising_payment_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      order_id BIGINT REFERENCES advertising_orders(id) ON DELETE SET NULL,
      event_type TEXT,
      payment_status TEXT,
      payload_sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      error_text TEXT,
      occurred_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      UNIQUE(provider, provider_event_id)
    );

    CREATE INDEX IF NOT EXISTS advertising_payment_events_received_idx
      ON advertising_payment_events(received_at DESC);

    CREATE TABLE IF NOT EXISTS account_age_verification (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT,
      status TEXT NOT NULL DEFAULT 'unverified',
      age_threshold SMALLINT NOT NULL DEFAULT 18,
      verified_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      provider_reference_hash TEXT,
      result_code TEXT,
      last_event_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT account_age_verification_status_check
        CHECK (status IN ('unverified', 'pending', 'verified', 'failed', 'expired', 'revoked')),
      CONSTRAINT account_age_verification_threshold_check
        CHECK (age_threshold BETWEEN 18 AND 30)
    );

    CREATE INDEX IF NOT EXISTS account_age_verification_status_idx
      ON account_age_verification(status, expires_at);

    CREATE TABLE IF NOT EXISTS age_verification_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      payload_sha256 TEXT NOT NULL,
      error_text TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      UNIQUE(provider, provider_event_id)
    );

    CREATE INDEX IF NOT EXISTS age_verification_events_received_idx
      ON age_verification_events(received_at DESC);

    CREATE INDEX IF NOT EXISTS age_verification_events_provider_status_idx
      ON age_verification_events(provider, status, received_at DESC);



    CREATE TABLE IF NOT EXISTS account_entitlement_overrides (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entitlement_key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL,
      reason TEXT,
      expires_at TIMESTAMPTZ,
      created_by_admin_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, entitlement_key)
    );

    CREATE INDEX IF NOT EXISTS account_entitlement_overrides_user_idx
      ON account_entitlement_overrides(user_id, entitlement_key);

    CREATE TABLE IF NOT EXISTS complimentary_top_tier_grants (
      slot SMALLINT PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT complimentary_slot_check CHECK (slot BETWEEN 1 AND 5)
    );

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id BIGSERIAL PRIMARY KEY,
      admin_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      admin_email TEXT NOT NULL,
      action TEXT NOT NULL,
      target_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      target_email TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
      ON admin_audit_log(created_at DESC);

    CREATE INDEX IF NOT EXISTS admin_audit_log_target_user_id_idx
      ON admin_audit_log(target_user_id);

    CREATE TABLE IF NOT EXISTS usage_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'chat',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      web_search_calls INTEGER NOT NULL DEFAULT 0,
      estimated_cost_micros BIGINT,
      provider_response_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE usage_events
      ADD COLUMN IF NOT EXISTS web_search_calls INTEGER NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS usage_events_created_at_idx
      ON usage_events(created_at DESC);

    CREATE INDEX IF NOT EXISTS usage_events_user_id_idx
      ON usage_events(user_id);

    CREATE INDEX IF NOT EXISTS usage_events_provider_model_idx
      ON usage_events(provider, model);
  `);

  await pool.query(`
    DELETE FROM rate_limit_buckets
    WHERE updated_at < NOW() - INTERVAL '7 days';

    DELETE FROM rate_limit_blocks
    WHERE created_at < NOW() - INTERVAL '30 days';

    DELETE FROM passkey_challenges
    WHERE expires_at <= NOW();
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

async function initializeDatabaseWithRetry() {
  if (shuttingDown || databaseInitializing) return;

  databaseInitializing = true;
  databaseInitAttempt += 1;
  databaseReady = false;
  console.log(`UNBOUND AI database initialization attempt ${databaseInitAttempt} started.`);

  try {
    await initializeDatabase();
    if (databaseReady) {
      databaseInitAttempt = 0;
    }
  } catch (error) {
    databaseReady = false;
    databaseError = error?.message || "Database initialization failed.";
    console.error(
      `UNBOUND AI DATABASE INITIALIZATION FAILED (attempt ${databaseInitAttempt}):`,
      error
    );
  } finally {
    databaseInitializing = false;
  }

  if (!databaseReady && process.env.DATABASE_URL) {
    scheduleDatabaseInitialization("initialization-failure");
  }
}

void initializeDatabaseWithRetry();

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


function hashDeviceToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setDeviceCookie(res, token) {
  const maxAge = DEVICE_DAYS * 24 * 60 * 60;
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${DEVICE_COOKIE}=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}



function clearDeviceCookie(res) {
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${DEVICE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

function coarseDeviceLabel(req) {
  const ua = String(req?.headers?.["user-agent"] || "").toLowerCase();
  let browser = "Browser";
  let os = "device";

  if (ua.includes("edg/")) browser = "Edge";
  else if (ua.includes("firefox/")) browser = "Firefox";
  else if (ua.includes("chrome/") || ua.includes("crios/")) browser = "Chrome";
  else if (ua.includes("safari/")) browser = "Safari";

  if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "iPhone/iPad";
  else if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os") || ua.includes("macintosh")) os = "Mac";
  else if (ua.includes("linux")) os = "Linux";

  return `${browser} on ${os}`.slice(0, 80);
}

async function writeSecurityEvent(
  client,
  userId,
  eventType,
  deviceId = null,
  details = {},
  severity = "info"
) {
  await client.query(
    `INSERT INTO account_security_events (
       user_id,
       device_id,
       event_type,
       severity,
       details
     )
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, deviceId, eventType, severity, JSON.stringify(details || {})]
  );
}




async function writeSecurityAlert(
  client,
  userId,
  {
    eventType,
    severity = "info",
    title,
    message,
    deviceId = null
  }
) {
  const normalizedSeverity = normalizeAlertSeverity(severity);
  const result = await client.query(
    `INSERT INTO account_security_alerts (
       user_id,
       device_id,
       event_type,
       severity,
       title,
       message
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [
      userId,
      deviceId,
      String(eventType || "security.alert").slice(0, 120),
      normalizedSeverity,
      String(title || "Security alert").slice(0, 160),
      String(message || "Review your account security.").slice(0, 800)
    ]
  );
  return result.rows[0] || null;
}


async function recordFailedPasswordSignIn(userId, req) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [userId]);

    await writeSecurityEvent(
      client,
      userId,
      "auth.password_failed",
      null,
      { label: coarseDeviceLabel(req) },
      "warning"
    );

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS failures
       FROM account_security_events
       WHERE user_id = $1
         AND event_type = 'auth.password_failed'
         AND created_at >= NOW() - ($2::int * INTERVAL '1 minute')`,
      [userId, SIGNIN_RISK_CONFIG.failedPasswordWindowMinutes]
    );
    const failures = Number(countResult.rows[0]?.failures || 0);

    if (failures >= SIGNIN_RISK_CONFIG.failedPasswordThreshold) {
      const existingAlert = await client.query(
        `SELECT id
         FROM account_security_alerts
         WHERE user_id = $1
           AND event_type = 'auth.repeated_failed_sign_in'
           AND created_at >= NOW() - ($2::int * INTERVAL '1 minute')
         LIMIT 1`,
        [userId, SIGNIN_RISK_CONFIG.failedPasswordWindowMinutes]
      );

      if (!existingAlert.rows[0]) {
        const alert = buildRepeatedFailureAlert({
          count: failures,
          windowMinutes: SIGNIN_RISK_CONFIG.failedPasswordWindowMinutes
        });
        await writeSecurityAlert(client, userId, alert);
      }
    }

    await client.query("COMMIT");
    return failures;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

function publicSecurityAlert(row) {
  return {
    id: String(row.id),
    eventType: row.event_type,
    severity: normalizeAlertSeverity(row.severity),
    title: row.title,
    message: row.message,
    deviceLabel: row.device_label || null,
    acknowledgedAt: row.acknowledged_at || null,
    createdAt: row.created_at
  };
}

function publicSecurityEvent(row) {
  const details = row?.details && typeof row.details === "object" ? row.details : {};
  const publicDetails = {};
  for (const key of [
    "label",
    "revokedDeviceId",
    "revokedSessions",
    "otherSessionsRevoked",
    "recoveryCodesGenerated",
    "passkeysRemoved",
    "devicesRevoked"
  ]) {
    if (details[key] !== undefined && details[key] !== null) {
      publicDetails[key] = details[key];
    }
  }

  return {
    id: String(row.id),
    eventType: row.event_type,
    severity: row.severity || "info",
    deviceLabel: row.device_label || null,
    details: publicDetails,
    createdAt: row.created_at
  };
}

async function ensureDeviceForRequest(userId, req, res, client = pool) {
  let token = parseCookies(req)[DEVICE_COOKIE];
  let issuedCookie = false;

  if (!token) {
    token = crypto.randomBytes(32).toString("base64url");
    issuedCookie = true;
  }

  let tokenHash = hashDeviceToken(token);
  const label = coarseDeviceLabel(req);
  const existingResult = await client.query(
    `SELECT id, device_label, revoked_at
     FROM account_devices
     WHERE user_id = $1 AND device_token_hash = $2
     LIMIT 1`,
    [userId, tokenHash]
  );
  const existing = existingResult.rows[0] || null;
  const replacedRevokedDeviceId = existing?.revoked_at ? String(existing.id) : null;
  let device = null;
  let isNewDevice = false;

  if (existing && !existing.revoked_at) {
    const updated = await client.query(
      `UPDATE account_devices
       SET device_label = $1,
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, device_label, first_seen_at, last_seen_at, revoked_at`,
      [label, existing.id, userId]
    );
    device = updated.rows[0];
  } else {
    if (existing?.revoked_at) {
      token = crypto.randomBytes(32).toString("base64url");
      tokenHash = hashDeviceToken(token);
      issuedCookie = true;
    }

    const inserted = await client.query(
      `INSERT INTO account_devices (
         user_id,
         device_token_hash,
         device_label,
         first_seen_at,
         last_seen_at,
         updated_at
       )
       VALUES ($1, $2, $3, NOW(), NOW(), NOW())
       RETURNING id, device_label, first_seen_at, last_seen_at, revoked_at`,
      [userId, tokenHash, label]
    );
    device = inserted.rows[0];
    isNewDevice = true;
  }

  if (issuedCookie) {
    setDeviceCookie(res, token);
  }

  if (isNewDevice) {
    await writeSecurityEvent(
      client,
      userId,
      replacedRevokedDeviceId ? "device.revoked_token_replaced" : "device.registered",
      device.id,
      {
        label: device.device_label,
        replacedRevokedDeviceId
      },
      replacedRevokedDeviceId ? "warning" : "info"
    );
  }

  return {
    ...device,
    isNewDevice,
    replacedRevokedDeviceId
  };
}

async function associateCurrentSessionWithDevice(userId, req, res, client = pool) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return { device: null, tokenHash: null };

  const tokenHash = hashSessionToken(token);
  const device = await ensureDeviceForRequest(userId, req, res, client);
  await client.query(
    `UPDATE user_sessions
     SET device_id = $1
     WHERE user_id = $2 AND token_hash = $3`,
    [device.id, userId, tokenHash]
  );
  return { device, tokenHash };
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

  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = IS_PRODUCTION ? "; Secure" : "";

  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

async function createSession(
  userId,
  res,
  req = null,
  { notifyNewDevice = true, authMethod = "password" } = {}
) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const client = await pool.connect();
  let device = null;

  try {
    await client.query("BEGIN");
    device = req ? await ensureDeviceForRequest(userId, req, res, client) : null;

    await client.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at, device_id)
       VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days', $3)`,
      [userId, tokenHash, device?.id || null]
    );

    if (notifyNewDevice && device?.isNewDevice) {
      const alert = buildNewDeviceAlert({
        label: device.device_label,
        authMethod,
        replacedRevokedDevice: Boolean(device.replacedRevokedDeviceId)
      });
      await writeSecurityAlert(client, userId, {
        ...alert,
        deviceId: device.id
      });
    }

    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  setSessionCookie(res, token);
  return { device };
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

async function writeAdminAudit(
  client,
  adminUser,
  action,
  targetUser = null,
  details = {}
) {
  await client.query(
    `INSERT INTO admin_audit_log (
       admin_user_id,
       admin_email,
       action,
       target_user_id,
       target_email,
       details
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      adminUser?.id || null,
      adminUser?.email || "unknown-admin",
      action,
      targetUser?.id || null,
      targetUser?.email || null,
      JSON.stringify(details || {})
    ]
  );
}

function numberFromEnv(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function estimateProviderCostMicros(provider, usage) {
  const prefix = String(provider || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");

  if (!prefix) {
    return null;
  }

  const inputRate = numberFromEnv(prefix + "_INPUT_USD_PER_MILLION");
  const outputRate = numberFromEnv(prefix + "_OUTPUT_USD_PER_MILLION");

  if (inputRate === null || outputRate === null) {
    return null;
  }

  const inputTokens = Number(usage?.input_tokens || 0);
  const outputTokens = Number(usage?.output_tokens || 0);

  // USD-per-million-token pricing converts directly to microdollars per token.
  return Math.max(
    0,
    Math.round(inputTokens * inputRate + outputTokens * outputRate)
  );
}

async function recordUsageEvent({
  userId = null,
  provider,
  model,
  eventType = "chat",
  usage = null,
  webSearchCalls = 0,
  estimatedCostMicros = null,
  providerResponseId = null
}) {
  if (!databaseReady || !pool || (!usage && !webSearchCalls)) {
    return;
  }

  const inputTokens = Math.max(0, Number(usage?.input_tokens || 0));
  const outputTokens = Math.max(0, Number(usage?.output_tokens || 0));
  const totalTokens = Math.max(
    0,
    Number(usage?.total_tokens || inputTokens + outputTokens)
  );

  await pool.query(
    `INSERT INTO usage_events (
       user_id,
       provider,
       model,
       event_type,
       input_tokens,
       output_tokens,
       total_tokens,
       web_search_calls,
       estimated_cost_micros,
       provider_response_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      userId,
      provider,
      model,
      eventType,
      inputTokens,
      outputTokens,
      totalTokens,
      Math.max(0, Number(webSearchCalls || 0)),
      estimatedCostMicros,
      providerResponseId
    ]
  );
}


async function loadAccountSubscription(userId, client = pool) {
  const result = await client.query(
    `SELECT
       provider,
       provider_customer_id IS NOT NULL AS provider_customer_connected,
       status,
       plan_tier,
       current_period_start,
       current_period_end,
       cancel_at_period_end,
       created_at,
       updated_at
     FROM account_subscriptions
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}



async function loadAgeVerification(userId, client = pool) {
  const result = await client.query(
    `SELECT
       provider,
       status,
       age_threshold,
       verified_at,
       expires_at,
       provider_reference_hash IS NOT NULL AS provider_reference_recorded,
       result_code,
       last_event_at,
       created_at,
       updated_at
     FROM account_age_verification
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

function publicAgeVerification(row) {
  const status = normalizeAgeVerificationStatus(row?.status);
  return {
    provider: row?.provider || null,
    status,
    verified: ageVerificationAllowsAdultAccess(status, row?.expires_at),
    ageThreshold: Number(row?.age_threshold || 18),
    verifiedAt: row?.verified_at || null,
    expiresAt: row?.expires_at || null,
    providerReferenceRecorded: Boolean(row?.provider_reference_recorded),
    resultCode: row?.result_code || null,
    lastEventAt: row?.last_event_at || null,
    updatedAt: row?.updated_at || null
  };
}

function ageVerificationHmac(value, purpose) {
  const secret = process.env.AGE_VERIFICATION_HASH_SECRET || RATE_LIMIT_SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update(`${purpose}:${String(value || "")}`)
    .digest("hex");
}

function billingSubject(userId) {
  const secret = process.env.BILLING_SUBJECT_SECRET || RATE_LIMIT_SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update(`billing:${String(userId || "")}`)
    .digest("hex");
}

function ageVerificationSubject(userId) {
  return ageVerificationHmac(userId, "subject");
}

function hashAgeVerificationReference(reference) {
  return ageVerificationHmac(reference, "provider-reference");
}

async function buildAgeVerificationState(userId) {
  const row = await loadAgeVerification(userId);
  return publicAgeVerification(row);
}

async function assertAgeVerifiedAdult(req) {
  if (!databaseReady || !pool) {
    const error = new Error("Age verification is temporarily unavailable.");
    error.statusCode = 503;
    throw error;
  }

  const user = req.user || (await findSessionUser(req));
  if (!user) {
    const error = new Error("Sign in before using age-restricted UNBOUND AI features.");
    error.statusCode = 401;
    throw error;
  }

  const ageVerification = await buildAgeVerificationState(user.id);
  if (!ageVerification.verified) {
    const error = new Error(
      "Hard 18+ age verification is required for that UNBOUND AI feature."
    );
    error.statusCode = 403;
    error.ageVerification = ageVerification;
    throw error;
  }

  return { user, ageVerification };
}

function requireAgeVerifiedAdult(req, res, next) {
  assertAgeVerifiedAdult(req)
    .then((result) => {
      req.user = result.user;
      req.ageVerification = result.ageVerification;
      next();
    })
    .catch((error) => {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Could not verify adult access.",
        ageVerification: error.ageVerification || null
      });
    });
}

async function loadEntitlementOverrides(userId, client = pool) {
  const result = await client.query(
    `SELECT entitlement_key, enabled, reason, expires_at
     FROM account_entitlement_overrides
     WHERE user_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY entitlement_key`,
    [userId]
  );

  return result.rows;
}

function resolveEffectivePlan(user, subscription) {
  const manualPlan = getPlanDefinition(user?.plan_tier);

  if (user?.role === "admin") {
    return { plan: getPlanDefinition("top"), source: "administrator" };
  }

  if (user?.complimentary_top_tier) {
    return { plan: getPlanDefinition("top"), source: "complimentary" };
  }

  const subscriptionPlan =
    subscription && subscriptionStatusAllowsAccess(subscription.status)
      ? getPlanDefinition(subscription.plan_tier)
      : getPlanDefinition("free");

  if (subscriptionPlan.rank > manualPlan.rank) {
    return { plan: subscriptionPlan, source: "subscription" };
  }

  return {
    plan: manualPlan,
    source: manualPlan.id === "free" ? "default" : "manual"
  };
}

async function buildAccountAccess(user) {
  if (!user || !databaseReady || !pool) return null;

  const [subscription, overrides, ageVerification] = await Promise.all([
    loadAccountSubscription(user.id),
    loadEntitlementOverrides(user.id),
    buildAgeVerificationState(user.id)
  ]);
  const effective = resolveEffectivePlan(user, subscription);
  const capabilities = buildCapabilityAccess({
    planTier: effective.plan.id,
    overrides
  }).map((item) => {
    if (item.key !== "adult_mode") return item;
    return {
      ...item,
      usable: Boolean(item.usable && ageVerification.verified),
      ageVerificationRequired: true,
      blockedReason: ageVerification.verified
        ? null
        : "hard-age-verification-required"
    };
  });
  const ageVerificationGateway = getAgeVerificationGatewayStatus();

  return {
    plan: {
      tier: effective.plan.id,
      displayName: effective.plan.displayName,
      source: effective.source
    },
    subscription: {
      connected: Boolean(subscription && subscription.provider),
      customerConnected: Boolean(subscription?.provider_customer_connected),
      provider: subscription?.provider || null,
      status: normalizeSubscriptionStatus(subscription?.status),
      planTier: subscription ? normalizePlanTier(subscription.plan_tier) : null,
      currentPeriodStart: subscription?.current_period_start || null,
      currentPeriodEnd: subscription?.current_period_end || null,
      cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end)
    },
    capabilities,
    ageVerification,
    ageVerificationGateway,
    billingGateway: getBillingGatewayStatus(),
    summary: {
      usable: capabilities.filter((item) => item.usable).length,
      entitledButNotLive: capabilities.filter(
        (item) => item.entitled && !item.available
      ).length,
      catalogSize: capabilities.length
    }
  };
}

function requireCapability(capabilityKey) {
  return async function capabilityMiddleware(req, res, next) {
    try {
      const user = req.user || (await findSessionUser(req));
      if (!user) {
        return res.status(401).json({
          error: "Sign in to access that UNBOUND AI capability."
        });
      }

      const access = await buildAccountAccess(user);
      const capability = access?.capabilities.find(
        (item) => item.key === capabilityKey
      );

      if (!capability || !capability.usable) {
        return res.status(403).json({
          error: capability?.entitled && !capability?.available
            ? "That capability is included in your access level but is not live yet."
            : "Your current access level does not include that capability.",
          capability: capability || null
        });
      }

      req.user = user;
      req.accountAccess = access;
      next();
    } catch (error) {
      console.error("UNBOUND AI ENTITLEMENT ERROR:", error);
      return res.status(500).json({ error: "Could not verify account access." });
    }
  };
}


async function assertRequestCapability(req, capabilityKey) {
  if (!databaseReady || !pool) {
    const error = new Error("Account access is temporarily unavailable.");
    error.statusCode = 503;
    throw error;
  }

  const user = await findSessionUser(req);
  if (!user) {
    const error = new Error("Sign in with an account that includes that capability.");
    error.statusCode = 401;
    throw error;
  }

  const access = await buildAccountAccess(user);
  const capability = access?.capabilities.find((item) => item.key === capabilityKey);
  if (!capability || !capability.usable) {
    const error = new Error(
      capability?.entitled && !capability?.available
        ? "That capability is included in your access level but is not live yet."
        : "Your current access level does not include that capability."
    );
    error.statusCode = 403;
    throw error;
  }

  return { user, access, capability };
}


async function assertOptionalAccountCapability(req, capabilityKey) {
  const hasSessionCookie = Boolean(parseCookies(req)[SESSION_COOKIE]);
  if (!databaseReady || !pool) {
    if (hasSessionCookie) {
      const error = new Error("Account access is temporarily unavailable.");
      error.statusCode = 503;
      throw error;
    }
    return null;
  }

  const user = await findSessionUser(req);
  if (!user) {
    if (hasSessionCookie) {
      const error = new Error("Your session expired. Sign in again to continue.");
      error.statusCode = 401;
      throw error;
    }
    return null;
  }

  const access = await buildAccountAccess(user);
  const capability = access?.capabilities.find((item) => item.key === capabilityKey);
  if (!capability || !capability.usable) {
    const error = new Error(
      capability?.entitled && !capability?.available
        ? "That capability is included in your access level but is not live yet."
        : "Your current access level does not include that capability."
    );
    error.statusCode = 403;
    throw error;
  }

  return { user, access, capability };
}

async function requireSignedIn(req, res, next) {
  try {
    const user = await findSessionUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Sign in to access your UNBOUND AI account."
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("UNBOUND AI USER AUTH ERROR:", error);
    return res.status(500).json({
      error: "Could not verify your account session."
    });
  }
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



function setGuestRateCookie(res, token) {
  const maxAge = GUEST_RATE_DAYS * 24 * 60 * 60;
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${GUEST_RATE_COOKIE}=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearGuestRateCookie(res) {
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${GUEST_RATE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

function hashPasskeyFlowToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function setPasskeyFlowCookie(res, token) {
  const maxAge = getPasskeyConfig().challengeTtlSeconds;
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${PASSKEY_FLOW_COOKIE}=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearPasskeyFlowCookie(res) {
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${PASSKEY_FLOW_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

async function getOrCreatePasskeyUserHandle(userId, client = pool) {
  const existing = await client.query(
    `SELECT user_handle
     FROM account_passkey_user_handles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  if (existing.rows[0]?.user_handle) {
    return new Uint8Array(existing.rows[0].user_handle);
  }

  const handle = crypto.randomBytes(32);
  await client.query(
    `INSERT INTO account_passkey_user_handles (user_id, user_handle)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, handle]
  );
  const result = await client.query(
    `SELECT user_handle
     FROM account_passkey_user_handles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  if (!result.rows[0]?.user_handle) {
    throw new Error("Could not create a passkey user handle.");
  }
  return new Uint8Array(result.rows[0].user_handle);
}

function normalizePasskeyTransports(value) {
  const allowed = new Set([
    "ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"
  ]);
  return Array.isArray(value)
    ? Array.from(new Set(value.map(String).filter((item) => allowed.has(item)))).slice(0, 8)
    : [];
}

function publicPasskey(row) {
  return {
    id: String(row.id),
    label: row.label || "Passkey",
    deviceType: row.device_type || null,
    backedUp: Boolean(row.backed_up),
    transports: normalizePasskeyTransports(row.transports),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null
  };
}

async function storePasskeyChallenge({ ceremony, challenge, userId = null, res }) {
  const config = getPasskeyConfig();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashPasskeyFlowToken(token);
  await pool.query(
    `INSERT INTO passkey_challenges (
       flow_token_hash, ceremony, challenge, user_id, expires_at
     )
     VALUES ($1, $2, $3, $4, NOW() + ($5::int * INTERVAL '1 second'))`,
    [tokenHash, ceremony, challenge, userId, config.challengeTtlSeconds]
  );
  setPasskeyFlowCookie(res, token);
}

async function consumePasskeyChallenge(req, res, ceremony, userId = null) {
  const token = parseCookies(req)[PASSKEY_FLOW_COOKIE];
  clearPasskeyFlowCookie(res);
  if (!token) {
    const error = new Error("The passkey request expired. Start again.");
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(
    `DELETE FROM passkey_challenges
     WHERE flow_token_hash = $1
       AND ceremony = $2
       AND expires_at > NOW()
       AND (($3::bigint IS NULL AND user_id IS NULL) OR user_id = $3::bigint)
     RETURNING challenge`,
    [hashPasskeyFlowToken(token), ceremony, userId]
  );
  if (!result.rows[0]) {
    const error = new Error("The passkey request expired or was already used. Start again.");
    error.statusCode = 400;
    throw error;
  }
  return result.rows[0].challenge;
}

function ensureGuestRateToken(req, res) {
  let token = parseCookies(req)[GUEST_RATE_COOKIE];
  if (!token) {
    token = crypto.randomBytes(32).toString("base64url");
    setGuestRateCookie(res, token);
  }
  return token;
}

async function consumeRateLimit({
  scope,
  subjectKind,
  subjectValue,
  limit,
  windowSeconds
}) {
  if (!databaseReady || !pool) {
    return { allowed: true, count: 0, retryAfter: 0 };
  }

  const subjectHash = hashRateLimitSubject(
    RATE_LIMIT_SECRET,
    `${subjectKind}:${subjectValue}`
  );
  const result = await pool.query(
    `INSERT INTO rate_limit_buckets (
       scope,
       subject_hash,
       subject_kind,
       window_started_at,
       request_count,
       updated_at
     )
     VALUES ($1, $2, $3, NOW(), 1, NOW())
     ON CONFLICT (scope, subject_hash)
     DO UPDATE SET
       subject_kind = EXCLUDED.subject_kind,
       window_started_at = CASE
         WHEN rate_limit_buckets.window_started_at <=
              NOW() - ($4::int * INTERVAL '1 second')
           THEN NOW()
         ELSE rate_limit_buckets.window_started_at
       END,
       request_count = CASE
         WHEN rate_limit_buckets.window_started_at <=
              NOW() - ($4::int * INTERVAL '1 second')
           THEN 1
         ELSE rate_limit_buckets.request_count + 1
       END,
       updated_at = NOW()
     RETURNING window_started_at, request_count`,
    [scope, subjectHash, subjectKind, windowSeconds]
  );

  const row = result.rows[0];
  const count = Number(row?.request_count || 0);
  if (count <= limit) {
    return { allowed: true, count, retryAfter: 0 };
  }

  const windowStart = new Date(row.window_started_at).getTime();
  const retryAfter = Math.max(
    1,
    Math.ceil((windowStart + windowSeconds * 1000 - Date.now()) / 1000)
  );

  await pool.query(
    `INSERT INTO rate_limit_blocks (
       scope,
       subject_kind,
       request_count,
       limit_count,
       window_seconds
     )
     VALUES ($1, $2, $3, $4, $5)`,
    [scope, subjectKind, count, limit, windowSeconds]
  );

  return { allowed: false, count, retryAfter };
}

function rateLimitMiddleware({ policy, subjectResolver, when = null }) {
  return async function unboundRateLimit(req, res, next) {
    try {
      if (!databaseReady || !pool) return next();
      if (when && !(await when(req))) return next();

      const subject = await subjectResolver(req, res);
      if (!subject || !subject.value) return next();

      const result = await consumeRateLimit({
        scope: policy.scope,
        subjectKind: subject.kind,
        subjectValue: subject.value,
        limit: policy.limit,
        windowSeconds: policy.windowSeconds
      });

      res.setHeader("X-RateLimit-Limit", String(policy.limit));
      res.setHeader(
        "X-RateLimit-Remaining",
        String(Math.max(0, policy.limit - result.count))
      );

      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfter));
        return res.status(429).json({
          error: `Too many requests. Try again in about ${result.retryAfter} seconds.`,
          rateLimit: {
            scope: policy.scope,
            limit: policy.limit,
            windowSeconds: policy.windowSeconds,
            retryAfter: result.retryAfter
          }
        });
      }

      return next();
    } catch (error) {
      console.error("UNBOUND AI RATE LIMIT ERROR:", error);
      return res.status(503).json({
        error: "Abuse protection is temporarily unavailable. Please try again shortly."
      });
    }
  };
}

async function emailRateSubject(req) {
  return {
    kind: "email_hash",
    value: normalizeEmail(req.body?.email) || "missing-email"
  };
}

async function accountRateSubject(req) {
  const user = req.user || (await findSessionUser(req));
  if (!user) return null;
  req.user = user;
  return { kind: "account", value: String(user.id) };
}

async function chatRateSubject(req, res) {
  const user = req.user || (await findSessionUser(req));
  if (user) {
    req.user = user;
    return {
      policy: RATE_LIMIT_POLICY.accountChat,
      subject: { kind: "account", value: String(user.id) }
    };
  }

  return {
    policy: RATE_LIMIT_POLICY.guestChat,
    subject: {
      kind: "guest_browser",
      value: ensureGuestRateToken(req, res)
    }
  };
}

async function chatRateLimit(req, res, next) {
  try {
    if (!databaseReady || !pool) return next();
    const resolved = await chatRateSubject(req, res);
    const result = await consumeRateLimit({
      scope: resolved.policy.scope,
      subjectKind: resolved.subject.kind,
      subjectValue: resolved.subject.value,
      limit: resolved.policy.limit,
      windowSeconds: resolved.policy.windowSeconds
    });

    res.setHeader("X-RateLimit-Limit", String(resolved.policy.limit));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, resolved.policy.limit - result.count))
    );
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfter));
      return res.status(429).json({
        error: `Too many chat requests. Try again in about ${result.retryAfter} seconds.`,
        rateLimit: {
          scope: resolved.policy.scope,
          limit: resolved.policy.limit,
          windowSeconds: resolved.policy.windowSeconds,
          retryAfter: result.retryAfter
        }
      });
    }
    return next();
  } catch (error) {
    console.error("UNBOUND AI CHAT RATE LIMIT ERROR:", error);
    return res.status(503).json({
      error: "Abuse protection is temporarily unavailable. Please try again shortly."
    });
  }
}

const loginRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.login,
  subjectResolver: emailRateSubject
});
const registerRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.register,
  subjectResolver: emailRateSubject
});
const passkeyAuthRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.passkeyAuth,
  subjectResolver: async (req, res) => ({
    kind: "guest_browser",
    value: ensureGuestRateToken(req, res)
  })
});
const recoveryRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.recovery,
  subjectResolver: emailRateSubject
});
const securityActionRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.securityActions,
  subjectResolver: accountRateSubject
});
const researchRateLimit = rateLimitMiddleware({
  policy: RATE_LIMIT_POLICY.research,
  subjectResolver: accountRateSubject,
  when: async (req) => normalizeProductMode(req.body?.productMode) === "research"
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    database: databaseReady ? "connected" : "not-connected",
    accounts: databaseReady ? "ready" : "not-ready",
    ai: getGatewayStatus(),
    commercial: databaseReady ? "entitlements-ready" : "not-ready",
    billing: getBillingGatewayStatus(),
    ageVerification: getAgeVerificationGatewayStatus(),
    abuseProtection: getRateLimitStatus(),
    httpSecurity: getHttpSecurityStatus({
      isProduction: IS_PRODUCTION,
      publicOrigin: process.env.PUBLIC_APP_ORIGIN || ""
    }),
    passkeys: getPasskeyStatus(),
    recovery: getRecoveryStatus(),
    securityAlerts: getSecurityAlertStatus(),
    signInRisk: getSignInRiskStatus()
  });
});

app.post("/api/auth/register", requireDatabase, registerRateLimit, async (req, res) => {
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

    await createSession(user.id, res, req, {
      notifyNewDevice: false,
      authMethod: "registration"
    });

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

app.post("/api/auth/login", requireDatabase, loginRateLimit, async (req, res) => {
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
      if (user && !passwordMatches) {
        try {
          await recordFailedPasswordSignIn(user.id, req);
        } catch (securityError) {
          console.error("UNBOUND AI FAILED SIGN-IN SECURITY LOG ERROR:", securityError);
        }
      }
      return res.status(401).json({
        error: "Email or password is incorrect."
      });
    }

    const sessionResult = await createSession(user.id, res, req);
    try {
      await writeSecurityEvent(
        pool,
        user.id,
        "auth.password_signed_in",
        sessionResult?.device?.id || null,
        { label: sessionResult?.device?.device_label || coarseDeviceLabel(req) }
      );
    } catch (securityError) {
      console.error("UNBOUND AI SIGN-IN SECURITY LOG ERROR:", securityError);
    }

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


app.post(
  "/api/auth/recovery-code/reset",
  requireDatabase,
  recoveryRateLimit,
  async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const recoveryCode =
      typeof req.body?.recoveryCode === "string" ? req.body.recoveryCode : "";
    const newPassword =
      typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    const newPasswordConfirm =
      typeof req.body?.newPasswordConfirm === "string"
        ? req.body.newPasswordConfirm
        : "";

    if (!isValidEmail(email) || !isRecoveryCodeShape(recoveryCode)) {
      return res.status(401).json({ error: "Recovery code or email is invalid." });
    }
    if (newPassword.length < 12 || newPassword.length > 200) {
      return res.status(400).json({
        error: "New password must be between 12 and 200 characters."
      });
    }
    if (newPassword !== newPasswordConfirm) {
      return res.status(400).json({ error: "The new passwords do not match." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash
         FROM users
         WHERE email = $1
         LIMIT 1
         FOR UPDATE`,
        [email]
      );
      const user = userResult.rows[0];
      const codeHash = hashRecoveryCode(recoveryCode);
      if (!user) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Recovery code or email is invalid." });
      }

      const codeResult = await client.query(
        `SELECT id
         FROM account_recovery_codes
         WHERE user_id = $1
           AND code_hash = $2
           AND used_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [user.id, codeHash]
      );
      if (!codeResult.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Recovery code or email is invalid." });
      }

      if (await verifyPassword(newPassword, user.password_hash)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Choose a new password that is different from the current password."
        });
      }

      const nextPasswordHash = await hashPassword(newPassword);
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [nextPasswordHash, user.id]
      );

      const sessions = await client.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1
         RETURNING id`,
        [user.id]
      );
      const devices = await client.query(
        `UPDATE account_devices
         SET revoked_at = COALESCE(revoked_at, NOW()),
             updated_at = NOW()
         WHERE user_id = $1
           AND revoked_at IS NULL
         RETURNING id`,
        [user.id]
      );
      const passkeys = await client.query(
        `DELETE FROM account_passkeys
         WHERE user_id = $1
         RETURNING id`,
        [user.id]
      );
      await client.query(
        `DELETE FROM passkey_challenges WHERE user_id = $1`,
        [user.id]
      );
      await client.query(
        `DELETE FROM account_recovery_codes WHERE user_id = $1`,
        [user.id]
      );

      await writeSecurityEvent(
        client,
        user.id,
        "recovery.code_used",
        null,
        {
          revokedSessions: Number(sessions.rowCount || 0),
          devicesRevoked: Number(devices.rowCount || 0),
          passkeysRemoved: Number(passkeys.rowCount || 0)
        },
        "warning"
      );
      await client.query("COMMIT");

      clearSessionCookie(res);
      clearDeviceCookie(res);
      clearPasskeyFlowCookie(res);
      return res.json({
        recovered: true,
        signInRequired: true,
        revokedSessions: Number(sessions.rowCount || 0),
        devicesRevoked: Number(devices.rowCount || 0),
        passkeysRemoved: Number(passkeys.rowCount || 0),
        recoveryCodesRemaining: 0
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI RECOVERY RESET ERROR:", error);
      return res.status(500).json({ error: "Could not recover the account." });
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/auth/passkey/options",
  requireDatabase,
  passkeyAuthRateLimit,
  async (req, res) => {
    try {
      const status = getPasskeyStatus();
      if (!status.enabled) {
        return res.status(503).json({ error: "Passkey authentication is not configured." });
      }
      const options = await generateAuthentication();
      await storePasskeyChallenge({
        ceremony: "authentication",
        challenge: options.challenge,
        userId: null,
        res
      });
      return res.json({ options });
    } catch (error) {
      console.error("UNBOUND AI PASSKEY AUTH OPTIONS ERROR:", error);
      return res.status(500).json({ error: "Could not start passkey sign-in." });
    }
  }
);

app.post(
  "/api/auth/passkey/verify",
  requireDatabase,
  passkeyAuthRateLimit,
  async (req, res) => {
    try {
      const response = req.body?.response;
      if (!response || typeof response.id !== "string" || !response.id) {
        clearPasskeyFlowCookie(res);
        return res.status(400).json({ error: "A passkey response is required." });
      }

      const expectedChallenge = await consumePasskeyChallenge(
        req,
        res,
        "authentication",
        null
      );
      const credentialResult = await pool.query(
        `SELECT
           p.id AS passkey_id,
           p.user_id,
           p.credential_id,
           p.public_key,
           p.signature_counter,
           p.transports,
           p.label,
           u.email,
           u.display_name,
           u.role,
           u.plan_tier,
           u.adult_confirmed_at,
           u.created_at,
           EXISTS (
             SELECT 1 FROM complimentary_top_tier_grants g WHERE g.user_id = u.id
           ) AS complimentary_top_tier
         FROM account_passkeys p
         JOIN users u ON u.id = p.user_id
         WHERE p.credential_id = $1
         LIMIT 1`,
        [response.id]
      );
      const row = credentialResult.rows[0];
      if (!row) {
        return res.status(401).json({ error: "That passkey is not registered with UNBOUND AI." });
      }

      const verification = await verifyAuthentication({
        response,
        expectedChallenge,
        credential: {
          id: row.credential_id,
          publicKey: new Uint8Array(row.public_key),
          counter: Number(row.signature_counter || 0),
          transports: normalizePasskeyTransports(row.transports)
        }
      });
      if (!verification.verified) {
        return res.status(401).json({ error: "Passkey verification failed." });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE account_passkeys
           SET signature_counter = $1,
               last_used_at = NOW()
           WHERE id = $2 AND user_id = $3`,
          [Number(verification.authenticationInfo?.newCounter || 0), row.passkey_id, row.user_id]
        );
        await writeSecurityEvent(
          client,
          row.user_id,
          "passkey.signed_in",
          null,
          { label: row.label || "Passkey" }
        );
        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }

      await createSession(row.user_id, res, req, {
        notifyNewDevice: true,
        authMethod: "passkey"
      });
      return res.json({
        user: publicUser({
          id: row.user_id,
          email: row.email,
          display_name: row.display_name,
          role: row.role,
          plan_tier: row.plan_tier,
          adult_confirmed_at: row.adult_confirmed_at,
          created_at: row.created_at,
          complimentary_top_tier: row.complimentary_top_tier
        })
      });
    } catch (error) {
      console.error("UNBOUND AI PASSKEY AUTH VERIFY ERROR:", error);
      return res.status(error.statusCode || 400).json({
        error: error.message || "Passkey sign-in failed."
      });
    }
  }
);

app.get(
  "/api/account/recovery-codes/status",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE used_at IS NULL)::int AS remaining,
           MAX(created_at) AS generated_at
         FROM account_recovery_codes
         WHERE user_id = $1`,
        [req.user.id]
      );
      return res.json({
        recovery: {
          ...getRecoveryStatus(),
          configured: Number(result.rows[0]?.remaining || 0) > 0,
          remaining: Number(result.rows[0]?.remaining || 0),
          generatedAt: result.rows[0]?.generated_at || null
        }
      });
    } catch (error) {
      console.error("UNBOUND AI RECOVERY STATUS ERROR:", error);
      return res.status(500).json({ error: "Could not load recovery-code status." });
    }
  }
);

app.post(
  "/api/account/recovery-codes/regenerate",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    if (!password || password.length > 200) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash
         FROM users
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [req.user.id]
      );
      const user = userResult.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
      const batchId = crypto.randomUUID();
      await client.query(
        `DELETE FROM account_recovery_codes WHERE user_id = $1`,
        [user.id]
      );
      for (const code of codes) {
        await client.query(
          `INSERT INTO account_recovery_codes (user_id, batch_id, code_hash)
           VALUES ($1, $2, $3)`,
          [user.id, batchId, hashRecoveryCode(code)]
        );
      }
      await writeSecurityEvent(
        client,
        user.id,
        "recovery.codes_generated",
        null,
        { recoveryCodesGenerated: codes.length },
        "warning"
      );
      await client.query("COMMIT");

      return res.json({
        recovery: {
          ...getRecoveryStatus(),
          configured: true,
          remaining: codes.length,
          generatedAt: new Date().toISOString()
        },
        codes,
        warning:
          "Save these recovery codes now. UNBOUND AI stores only hashes and cannot show these same codes again. Generating a new set invalidates the old set."
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI RECOVERY CODE GENERATION ERROR:", error);
      return res.status(500).json({ error: "Could not generate recovery codes." });
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/account/passkeys",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, label, device_type, backed_up, transports, created_at, last_used_at
         FROM account_passkeys
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC`,
        [req.user.id]
      );
      return res.json({
        passkeys: result.rows.map(publicPasskey),
        status: getPasskeyStatus()
      });
    } catch (error) {
      console.error("UNBOUND AI PASSKEY LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load passkeys." });
    }
  }
);

app.post(
  "/api/account/passkeys/register/options",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const config = getPasskeyConfig();
      const existing = await pool.query(
        `SELECT credential_id, transports
         FROM account_passkeys
         WHERE user_id = $1
         ORDER BY id`,
        [req.user.id]
      );
      if (existing.rows.length >= config.maxPasskeysPerAccount) {
        return res.status(409).json({
          error: `This account already has the maximum of ${config.maxPasskeysPerAccount} passkeys.`
        });
      }

      const userID = await getOrCreatePasskeyUserHandle(req.user.id);
      const options = await generateRegistration({
        userName: req.user.email,
        userDisplayName: req.user.display_name || req.user.email,
        userID,
        excludeCredentials: existing.rows.map((row) => ({
          id: row.credential_id,
          transports: normalizePasskeyTransports(row.transports)
        }))
      });
      await storePasskeyChallenge({
        ceremony: "registration",
        challenge: options.challenge,
        userId: req.user.id,
        res
      });
      return res.json({ options });
    } catch (error) {
      console.error("UNBOUND AI PASSKEY REGISTRATION OPTIONS ERROR:", error);
      return res.status(500).json({ error: "Could not start passkey registration." });
    }
  }
);

app.post(
  "/api/account/passkeys/register/verify",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const response = req.body?.response;
      const requestedLabel = typeof req.body?.label === "string" ? req.body.label.trim() : "";
      if (!response || typeof response.id !== "string" || !response.id) {
        clearPasskeyFlowCookie(res);
        return res.status(400).json({ error: "A passkey registration response is required." });
      }
      const expectedChallenge = await consumePasskeyChallenge(
        req,
        res,
        "registration",
        req.user.id
      );
      const verification = await verifyRegistration({ response, expectedChallenge });
      if (!verification.verified || !verification.registrationInfo?.credential) {
        return res.status(400).json({ error: "Passkey registration could not be verified." });
      }

      const info = verification.registrationInfo;
      const credential = info.credential;
      const label = (requestedLabel || `${coarseDeviceLabel(req)} passkey`).slice(0, 80);
      const result = await pool.query(
        `INSERT INTO account_passkeys (
           user_id, credential_id, public_key, signature_counter, transports,
           device_type, backed_up, label
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
         RETURNING id, label, device_type, backed_up, transports, created_at, last_used_at`,
        [
          req.user.id,
          credential.id,
          Buffer.from(credential.publicKey),
          Number(credential.counter || 0),
          JSON.stringify(normalizePasskeyTransports(credential.transports)),
          info.credentialDeviceType || null,
          Boolean(info.credentialBackedUp),
          label
        ]
      );
      await writeSecurityEvent(
        pool,
        req.user.id,
        "passkey.registered",
        null,
        {
          label,
          deviceType: info.credentialDeviceType || null,
          backedUp: Boolean(info.credentialBackedUp)
        }
      );
      return res.status(201).json({ passkey: publicPasskey(result.rows[0]) });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "That passkey is already registered." });
      }
      console.error("UNBOUND AI PASSKEY REGISTRATION VERIFY ERROR:", error);
      return res.status(error.statusCode || 400).json({
        error: error.message || "Passkey registration failed."
      });
    }
  }
);

app.delete(
  "/api/account/passkeys/:id",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const passkeyId = String(req.params.id || "").trim();
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!/^\d+$/.test(passkeyId)) {
        return res.status(400).json({ error: "Invalid passkey ID." });
      }
      if (!password || password.length > 200) {
        return res.status(400).json({ error: "Enter your current password to remove a passkey." });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const userResult = await client.query(
          `SELECT password_hash FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`,
          [req.user.id]
        );
        if (!userResult.rows[0] || !(await verifyPassword(password, userResult.rows[0].password_hash))) {
          await client.query("ROLLBACK");
          return res.status(401).json({ error: "Current password is incorrect." });
        }
        const deleted = await client.query(
          `DELETE FROM account_passkeys
           WHERE id = $1 AND user_id = $2
           RETURNING id, label`,
          [passkeyId, req.user.id]
        );
        if (!deleted.rows[0]) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Passkey not found." });
        }
        await writeSecurityEvent(
          client,
          req.user.id,
          "passkey.removed",
          null,
          { label: deleted.rows[0].label || "Passkey" },
          "warning"
        );
        await client.query("COMMIT");
        return res.json({ ok: true, passkeyId: String(deleted.rows[0].id) });
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("UNBOUND AI PASSKEY REMOVE ERROR:", error);
      return res.status(500).json({ error: "Could not remove that passkey." });
    }
  }
);

app.get(
  "/api/account/access",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const access = await buildAccountAccess(req.user);
      return res.json({ user: publicUser(req.user), access });
    } catch (error) {
      console.error("UNBOUND AI ACCOUNT ACCESS ERROR:", error);
      return res.status(500).json({ error: "Could not load account access." });
    }
  }
);






app.post(
  "/api/account/billing/checkout",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const access = await buildAccountAccess(req.user);
      if (access?.plan?.tier === "top") {
        return res.status(409).json({
          error: "This account already has TOP access.",
          gateway: getBillingGatewayStatus()
        });
      }

      const subject = billingSubject(req.user.id);
      const session = await startBillingCheckoutSession({
        subject,
        email: req.user.email,
        planTier: "top",
        successUrl: process.env.BILLING_SUCCESS_URL || null,
        cancelUrl: process.env.BILLING_CANCEL_URL || null,
        requestId: req.requestId || null
      });

      await pool.query(
        `INSERT INTO account_subscriptions (
           user_id, provider, status, plan_tier, billing_subject_hash, created_at, updated_at
         )
         VALUES ($1, $2, 'incomplete', 'top', $3, NOW(), NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           provider = EXCLUDED.provider,
           status = CASE
             WHEN account_subscriptions.status IN ('active', 'trialing')
               THEN account_subscriptions.status
             ELSE 'incomplete'
           END,
           plan_tier = 'top',
           billing_subject_hash = EXCLUDED.billing_subject_hash,
           updated_at = NOW()`,
        [req.user.id, session.provider, subject]
      );

      return res.status(201).json({
        checkout: {
          provider: session.provider,
          checkoutUrl: session.checkoutUrl,
          expiresAt: session.expiresAt
        },
        gateway: getBillingGatewayStatus()
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("BILLING_")) {
        return res.status(Number(error.statusCode) || 503).json({
          error: error.publicMessage || "Subscription checkout is unavailable.",
          code: error.code,
          gateway: getBillingGatewayStatus()
        });
      }
      console.error("UNBOUND AI BILLING CHECKOUT ERROR:", error);
      return res.status(500).json({ error: "Could not start subscription checkout." });
    }
  }
);

app.post(
  "/api/account/billing/portal",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const gateway = getBillingGatewayStatus();
      const result = await pool.query(
        `SELECT provider, provider_customer_id
         FROM account_subscriptions
         WHERE user_id = $1
         LIMIT 1`,
        [req.user.id]
      );
      const subscription = result.rows[0] || null;
      const storedProvider = String(subscription?.provider || "").trim().toLowerCase();
      const customerId = String(subscription?.provider_customer_id || "").trim();

      if (!customerId || !storedProvider) {
        return res.status(409).json({
          error: "No billing customer is connected to this account yet.",
          gateway
        });
      }
      if (!gateway.provider || storedProvider !== gateway.provider) {
        return res.status(409).json({
          error: "The stored billing customer does not match the active billing provider.",
          gateway
        });
      }

      const session = await startBillingCustomerPortalSession({
        subject: billingSubject(req.user.id),
        email: req.user.email,
        providerCustomerId: customerId,
        returnUrl: process.env.BILLING_PORTAL_RETURN_URL || null,
        requestId: req.requestId || null
      });

      return res.status(201).json({
        portal: {
          provider: session.provider,
          portalUrl: session.portalUrl,
          expiresAt: session.expiresAt
        },
        gateway: getBillingGatewayStatus()
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("BILLING_")) {
        return res.status(Number(error.statusCode) || 503).json({
          error: error.publicMessage || "Subscription management is unavailable.",
          code: error.code,
          gateway: getBillingGatewayStatus()
        });
      }
      console.error("UNBOUND AI BILLING PORTAL ERROR:", error);
      return res.status(500).json({ error: "Could not open subscription management." });
    }
  }
);

app.get(
  "/api/account/age-verification",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      return res.json({
        gateway: getAgeVerificationGatewayStatus(),
        ageVerification: await buildAgeVerificationState(req.user.id)
      });
    } catch (error) {
      console.error("UNBOUND AI ACCOUNT AGE VERIFICATION ERROR:", error);
      return res.status(500).json({ error: "Could not load age-verification status." });
    }
  }
);

app.post(
  "/api/account/age-verification/start",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const current = await buildAgeVerificationState(req.user.id);
      if (current.verified) {
        return res.status(409).json({
          error: "This account already has active hard 18+ verification.",
          gateway: getAgeVerificationGatewayStatus(),
          ageVerification: current
        });
      }

      const session = await startAgeVerificationSession({
        subject: ageVerificationSubject(req.user.id),
        returnUrl: process.env.AGE_VERIFICATION_RETURN_URL || null,
        cancelUrl: process.env.AGE_VERIFICATION_CANCEL_URL || null,
        requestId: req.requestId || null
      });
      const providerReferenceHash = hashAgeVerificationReference(
        session.providerReference
      );

      await pool.query(
        `INSERT INTO account_age_verification (
           user_id,
           provider,
           status,
           age_threshold,
           verified_at,
           expires_at,
           provider_reference_hash,
           result_code,
           last_event_at,
           created_at,
           updated_at
         )
         VALUES ($1, $2, 'pending', 18, NULL, $3, $4, 'started', NOW(), NOW(), NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           provider = EXCLUDED.provider,
           status = 'pending',
           age_threshold = 18,
           verified_at = NULL,
           expires_at = EXCLUDED.expires_at,
           provider_reference_hash = EXCLUDED.provider_reference_hash,
           result_code = 'started',
           last_event_at = NOW(),
           updated_at = NOW()`,
        [
          req.user.id,
          session.provider,
          session.expiresAt,
          providerReferenceHash
        ]
      );

      return res.status(201).json({
        verification: {
          provider: session.provider,
          status: "pending",
          minimumAge: 18,
          verificationUrl: session.verificationUrl,
          expiresAt: session.expiresAt
        },
        gateway: getAgeVerificationGatewayStatus()
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("AGE_VERIFICATION_")) {
        return res.status(Number(error.statusCode) || 503).json({
          error: error.publicMessage || "Hard age verification is unavailable.",
          code: error.code,
          gateway: getAgeVerificationGatewayStatus()
        });
      }

      console.error("UNBOUND AI AGE VERIFICATION START ERROR:", error);
      return res.status(500).json({
        error: "Could not start hard age verification."
      });
    }
  }
);

app.get(
  "/api/account/security",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const association = await associateCurrentSessionWithDevice(
        req.user.id,
        req,
        res
      );
      const tokenHash = association.tokenHash;
      const [sessionResult, deviceCountResult] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*)::int AS active_sessions,
             MAX(CASE WHEN token_hash = $2 THEN expires_at END) AS current_expires_at,
             MAX(CASE WHEN token_hash = $2 THEN device_id END) AS current_device_id
           FROM user_sessions
           WHERE user_id = $1
             AND expires_at > NOW()`,
          [req.user.id, tokenHash]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS registered_devices
           FROM account_devices
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [req.user.id]
        )
      ]);

      return res.json({
        activeSessions: Number(sessionResult.rows[0]?.active_sessions || 0),
        registeredDevices: Number(deviceCountResult.rows[0]?.registered_devices || 0),
        currentDeviceId: sessionResult.rows[0]?.current_device_id
          ? String(sessionResult.rows[0].current_device_id)
          : null,
        currentSessionExpiresAt: sessionResult.rows[0]?.current_expires_at || null
      });
    } catch (error) {
      console.error("UNBOUND AI ACCOUNT SECURITY STATUS ERROR:", error);
      return res.status(500).json({ error: "Could not load account security status." });
    }
  }
);

app.post(
  "/api/account/password",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    const currentPassword =
      typeof req.body.currentPassword === "string"
        ? req.body.currentPassword
        : "";
    const newPassword =
      typeof req.body.newPassword === "string" ? req.body.newPassword : "";
    const newPasswordConfirm =
      typeof req.body.newPasswordConfirm === "string"
        ? req.body.newPasswordConfirm
        : "";

    if (!currentPassword || currentPassword.length > 200) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    if (newPassword.length < 12 || newPassword.length > 200) {
      return res.status(400).json({
        error: "New password must be between 12 and 200 characters."
      });
    }

    if (newPassword !== newPasswordConfirm) {
      return res.status(400).json({ error: "The new passwords do not match." });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash
         FROM users
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [req.user.id]
      );
      const user = userResult.rows[0];

      if (!user) {
        await client.query("ROLLBACK");
        clearSessionCookie(res);
        return res.status(404).json({ error: "Account not found." });
      }

      if (!(await verifyPassword(currentPassword, user.password_hash))) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      if (await verifyPassword(newPassword, user.password_hash)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Choose a new password that is different from your current password."
        });
      }

      const nextHash = await hashPassword(newPassword);
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [nextHash, user.id]
      );

      const revoked = await client.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1
         RETURNING id`,
        [user.id]
      );

      const device = await ensureDeviceForRequest(user.id, req, res, client);
      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = hashSessionToken(token);
      await client.query(
        `INSERT INTO user_sessions (user_id, token_hash, expires_at, device_id)
         VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days', $3)`,
        [user.id, tokenHash, device.id]
      );
      await writeSecurityEvent(
        client,
        user.id,
        "password.changed",
        device.id,
        { otherSessionsRevoked: Math.max(Number(revoked.rowCount || 0) - 1, 0) }
      );

      await client.query("COMMIT");
      setSessionCookie(res, token);

      return res.json({
        ok: true,
        passwordChanged: true,
        otherSessionsRevoked: Math.max(Number(revoked.rowCount || 0) - 1, 0),
        activeSessions: 1
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("UNBOUND AI PASSWORD CHANGE ROLLBACK ERROR:", rollbackError);
      }
      console.error("UNBOUND AI PASSWORD CHANGE ERROR:", error);
      return res.status(500).json({ error: "Could not change the password." });
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/account/sessions/revoke-others",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    const token = parseCookies(req)[SESSION_COOKIE];

    if (!password || password.length > 200) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    if (!token) {
      return res.status(401).json({ error: "Your current session is not available." });
    }

    const tokenHash = hashSessionToken(token);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash
         FROM users
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [req.user.id]
      );
      const user = userResult.rows[0];

      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      const currentResult = await client.query(
        `SELECT id, device_id
         FROM user_sessions
         WHERE user_id = $1
           AND token_hash = $2
           AND expires_at > NOW()
         LIMIT 1`,
        [user.id, tokenHash]
      );

      if (!currentResult.rows[0]) {
        await client.query("ROLLBACK");
        clearSessionCookie(res);
        return res.status(401).json({ error: "Your current session has expired." });
      }

      const revoked = await client.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1
           AND token_hash <> $2
         RETURNING id`,
        [user.id, tokenHash]
      );

      await writeSecurityEvent(
        client,
        user.id,
        "sessions.others_revoked",
        currentResult.rows[0]?.device_id || null,
        { revokedSessions: Number(revoked.rowCount || 0) }
      );
      await client.query("COMMIT");
      return res.json({
        ok: true,
        revokedSessions: Number(revoked.rowCount || 0),
        activeSessions: 1
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("UNBOUND AI SESSION REVOCATION ROLLBACK ERROR:", rollbackError);
      }
      console.error("UNBOUND AI SESSION REVOCATION ERROR:", error);
      return res.status(500).json({ error: "Could not revoke other sessions." });
    } finally {
      client.release();
    }
  }
);



app.get(
  "/api/account/security/alerts",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const requested = Number(req.query.limit || 50);
      const limit = Math.min(
        Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 50, 1),
        100
      );
      const [alertsResult, unreadResult] = await Promise.all([
        pool.query(
          `SELECT
             a.id,
             a.event_type,
             a.severity,
             a.title,
             a.message,
             a.acknowledged_at,
             a.created_at,
             d.device_label
           FROM account_security_alerts a
           LEFT JOIN account_devices d ON d.id = a.device_id
           WHERE a.user_id = $1
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT $2`,
          [req.user.id, limit]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS unread
           FROM account_security_alerts
           WHERE user_id = $1 AND acknowledged_at IS NULL`,
          [req.user.id]
        )
      ]);

      return res.json({
        alerts: alertsResult.rows.map(publicSecurityAlert),
        unread: Number(unreadResult.rows[0]?.unread || 0)
      });
    } catch (error) {
      console.error("UNBOUND AI SECURITY ALERT LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load security alerts." });
    }
  }
);

app.post(
  "/api/account/security/alerts/:alertId/acknowledge",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const alertId = String(req.params.alertId || "");
      if (!/^\d+$/.test(alertId)) {
        return res.status(400).json({ error: "Security alert id is invalid." });
      }
      const result = await pool.query(
        `UPDATE account_security_alerts
         SET acknowledged_at = COALESCE(acknowledged_at, NOW())
         WHERE id = $1 AND user_id = $2
         RETURNING id, acknowledged_at`,
        [alertId, req.user.id]
      );
      if (!result.rows[0]) {
        return res.status(404).json({ error: "Security alert not found." });
      }
      return res.json({
        ok: true,
        alertId,
        acknowledgedAt: result.rows[0].acknowledged_at
      });
    } catch (error) {
      console.error("UNBOUND AI SECURITY ALERT ACK ERROR:", error);
      return res.status(500).json({ error: "Could not acknowledge that security alert." });
    }
  }
);

app.post(
  "/api/account/security/alerts/acknowledge-all",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE account_security_alerts
         SET acknowledged_at = NOW()
         WHERE user_id = $1 AND acknowledged_at IS NULL
         RETURNING id`,
        [req.user.id]
      );
      return res.json({
        ok: true,
        acknowledged: Number(result.rowCount || 0)
      });
    } catch (error) {
      console.error("UNBOUND AI SECURITY ALERT ACK ALL ERROR:", error);
      return res.status(500).json({ error: "Could not acknowledge security alerts." });
    }
  }
);

app.get(
  "/api/account/security/events",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const requested = Number(req.query.limit || 25);
      const limit = Math.min(Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 25, 1), 100);
      const result = await pool.query(
        `SELECT
           e.id,
           e.event_type,
           e.severity,
           e.details,
           e.created_at,
           d.device_label
         FROM account_security_events e
         LEFT JOIN account_devices d ON d.id = e.device_id AND d.user_id = e.user_id
         WHERE e.user_id = $1
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT $2`,
        [req.user.id, limit]
      );

      return res.json({ events: result.rows.map(publicSecurityEvent) });
    } catch (error) {
      console.error("UNBOUND AI SECURITY EVENT HISTORY ERROR:", error);
      return res.status(500).json({ error: "Could not load security activity." });
    }
  }
);

app.get(
  "/api/account/devices",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const association = await associateCurrentSessionWithDevice(
        req.user.id,
        req,
        res
      );
      const currentDeviceId = association.device?.id || null;
      const result = await pool.query(
        `SELECT
           d.id,
           d.device_label,
           d.first_seen_at,
           d.last_seen_at,
           COUNT(s.id) FILTER (WHERE s.expires_at > NOW())::int AS active_sessions
         FROM account_devices d
         LEFT JOIN user_sessions s ON s.device_id = d.id AND s.user_id = d.user_id
         WHERE d.user_id = $1
           AND d.revoked_at IS NULL
         GROUP BY d.id
         ORDER BY (d.id = $2) DESC, d.last_seen_at DESC, d.id DESC`,
        [req.user.id, currentDeviceId]
      );

      return res.json({
        devices: result.rows.map((row) => ({
          id: String(row.id),
          label: row.device_label,
          current: currentDeviceId !== null && String(row.id) === String(currentDeviceId),
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
          activeSessions: Number(row.active_sessions || 0)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI DEVICE LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load registered devices." });
    }
  }
);

app.post(
  "/api/account/devices/:id/revoke",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    const deviceId = String(req.params.id || "").trim();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!/^\d+$/.test(deviceId)) {
      return res.status(400).json({ error: "Invalid device ID." });
    }
    if (!password || password.length > 200) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    const association = await associateCurrentSessionWithDevice(
      req.user.id,
      req,
      res
    );
    const tokenHash = association.tokenHash;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`,
        [req.user.id]
      );
      const user = userResult.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      const currentResult = await client.query(
        `SELECT device_id FROM user_sessions
         WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()
         LIMIT 1`,
        [user.id, tokenHash]
      );
      const currentDeviceId = currentResult.rows[0]?.device_id;
      if (currentDeviceId && String(currentDeviceId) === deviceId) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "You cannot revoke the device you are currently using. Use Log Out All Devices if you want to end this session too."
        });
      }

      const targetResult = await client.query(
        `SELECT id, device_label FROM account_devices
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
         LIMIT 1 FOR UPDATE`,
        [deviceId, user.id]
      );
      const target = targetResult.rows[0];
      if (!target) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Registered device not found." });
      }

      const revokedSessions = await client.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1 AND device_id = $2
         RETURNING id`,
        [user.id, target.id]
      );
      await client.query(
        `UPDATE account_devices
         SET revoked_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [target.id, user.id]
      );
      await writeSecurityEvent(
        client,
        user.id,
        "device.revoked",
        null,
        {
          revokedDeviceId: String(target.id),
          label: target.device_label,
          revokedSessions: Number(revokedSessions.rowCount || 0)
        },
        "warning"
      );
      await client.query("COMMIT");

      return res.json({
        ok: true,
        deviceId,
        revokedSessions: Number(revokedSessions.rowCount || 0)
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI DEVICE REVOKE ERROR:", error);
      return res.status(500).json({ error: "Could not revoke that device." });
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/account/sessions/revoke-all",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!password || password.length > 200) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`,
        [req.user.id]
      );
      const user = userResult.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      const revoked = await client.query(
        `DELETE FROM user_sessions WHERE user_id = $1 RETURNING id`,
        [user.id]
      );
      await writeSecurityEvent(
        client,
        user.id,
        "sessions.all_revoked",
        null,
        { revokedSessions: Number(revoked.rowCount || 0) },
        "warning"
      );
      await client.query("COMMIT");
      clearSessionCookie(res);
      return res.json({
        ok: true,
        loggedOut: true,
        revokedSessions: Number(revoked.rowCount || 0)
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI LOGOUT ALL DEVICES ERROR:", error);
      return res.status(500).json({ error: "Could not log out all devices." });
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/account",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    const confirmation =
      typeof req.body.confirmation === "string"
        ? req.body.confirmation.trim()
        : "";

    if (confirmation !== "DELETE") {
      return res.status(400).json({
        error: 'Type DELETE exactly to confirm permanent account deletion.'
      });
    }

    if (!password || password.length > 200) {
      return res.status(400).json({
        error: "Enter your current password to delete your account."
      });
    }

    const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);
    if (ownerEmail && normalizeEmail(req.user.email) === ownerEmail) {
      return res.status(403).json({
        error:
          "The platform owner account cannot be deleted from the public account-deletion flow."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const lockedUserResult = await client.query(
        `SELECT id, email, password_hash
         FROM users
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [req.user.id]
      );
      const lockedUser = lockedUserResult.rows[0];

      if (!lockedUser) {
        await client.query("ROLLBACK");
        clearSessionCookie(res);
        return res.status(404).json({ error: "Account not found." });
      }

      const passwordMatches = await verifyPassword(
        password,
        lockedUser.password_hash
      );

      if (!passwordMatches) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      const subscriptionResult = await client.query(
        `SELECT
           provider,
           provider_subscription_id,
           status,
           cancel_at_period_end,
           current_period_end
         FROM account_subscriptions
         WHERE user_id = $1
         LIMIT 1
         FOR UPDATE`,
        [lockedUser.id]
      );
      const deletionBlock = publicDeletionBlock(subscriptionResult.rows[0] || null);

      if (deletionBlock) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error:
            "Cancel the external subscription and wait until it reaches canceled status before deleting this UNBOUND AI account.",
          deletionBlocked: deletionBlock
        });
      }

      // Operational usage and provider webhook records may be retained for
      // aggregate integrity, fraud prevention, or reconciliation. Remove the
      // account link and provider-response/error correlation fields first.
      await client.query(
        `UPDATE usage_events
         SET user_id = NULL,
             provider_response_id = NULL
         WHERE user_id = $1`,
        [lockedUser.id]
      );
      await client.query(
        `UPDATE age_verification_events
         SET user_id = NULL,
             error_text = NULL
         WHERE user_id = $1`,
        [lockedUser.id]
      );

      // Audit records are intentionally retained for platform integrity, but
      // identifying account email fields are scrubbed before the user row is
      // deleted. Foreign-key user IDs become NULL through ON DELETE SET NULL.
      await client.query(
        `UPDATE admin_audit_log
         SET target_email = NULL
         WHERE target_user_id = $1`,
        [lockedUser.id]
      );
      await client.query(
        `UPDATE admin_audit_log
         SET admin_email = 'deleted-account'
         WHERE admin_user_id = $1`,
        [lockedUser.id]
      );

      const deleted = await client.query(
        `DELETE FROM users
         WHERE id = $1
         RETURNING id`,
        [lockedUser.id]
      );

      if (!deleted.rows[0]) {
        throw new Error("Account deletion did not remove the user record.");
      }

      await client.query("COMMIT");
      clearSessionCookie(res);
      clearDeviceCookie(res);
      clearGuestRateCookie(res);

      return res.json({
        ok: true,
        deleted: true
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("UNBOUND AI ACCOUNT DELETE ROLLBACK ERROR:", rollbackError);
      }

      console.error("UNBOUND AI ACCOUNT DELETE ERROR:", error);
      return res.status(500).json({
        error: "Could not delete the account. No partial deletion was accepted."
      });
    } finally {
      client.release();
    }
  }
);


function publicAiPreferences(row) {
  return {
    aiStyle: normalizeAiStyle(row?.ai_style),
    updatedAt: row?.updated_at || null
  };
}

async function loadAiPreferences(userId, client = pool) {
  const result = await client.query(
    `SELECT ai_style, updated_at
     FROM user_ai_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  return publicAiPreferences(result.rows[0] || null);
}

async function resolveAiStyleForRequest(req, knownUser = null) {
  const user = knownUser || (databaseReady && pool ? await findSessionUser(req) : null);
  if (user && databaseReady && pool) {
    return (await loadAiPreferences(user.id)).aiStyle;
  }
  return normalizeAiStyle(req.body?.aiStyle);
}

app.get(
  "/api/account/ai-preferences",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      return res.json({
        preferences: await loadAiPreferences(req.user.id),
        styles: listAiStyles()
      });
    } catch (error) {
      console.error("UNBOUND AI AI PREFERENCE LOAD ERROR:", error);
      return res.status(500).json({ error: "Could not load AI style preferences." });
    }
  }
);

app.post(
  "/api/account/ai-preferences",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const requested = String(req.body?.aiStyle || "").trim().toLowerCase();
      const normalized = normalizeAiStyle(requested);
      if (!requested || requested !== normalized) {
        return res.status(400).json({
          error: "Choose a supported UNBOUND AI style.",
          styles: listAiStyles()
        });
      }

      const result = await pool.query(
        `INSERT INTO user_ai_preferences (user_id, ai_style, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET ai_style = EXCLUDED.ai_style, updated_at = NOW()
         RETURNING ai_style, updated_at`,
        [req.user.id, normalized]
      );

      return res.json({
        ok: true,
        preferences: publicAiPreferences(result.rows[0]),
        styles: listAiStyles()
      });
    } catch (error) {
      console.error("UNBOUND AI AI PREFERENCE SAVE ERROR:", error);
      return res.status(500).json({ error: "Could not save AI style preferences." });
    }
  }
);


app.get(
  "/api/account/export",
  requireDatabase,
  requireSignedIn,
  requireCapability("data_export"),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const [
        accountResult,
        preferences,
        access,
        conversationResult,
        deviceResult,
        securityEventResult,
        securityAlertResult,
        passkeyResult,
        recoveryResult,
        usageResult,
        overrideResult
      ] = await Promise.all([
        pool.query(
          `SELECT id, email, display_name, role, plan_tier,
                  adult_confirmed_at, created_at, updated_at
           FROM users
           WHERE id = $1
           LIMIT 1`,
          [userId]
        ),
        loadAiPreferences(userId),
        buildAccountAccess(req.user),
        pool.query(
          `SELECT
             c.id AS conversation_id,
             c.title,
             c.depth_style,
             c.product_mode,
             c.created_at AS conversation_created_at,
             c.updated_at AS conversation_updated_at,
             m.id AS message_id,
             m.role AS message_role,
             m.content AS message_content,
             m.research_sources,
             m.research_citations,
             m.created_at AS message_created_at
           FROM conversations c
           LEFT JOIN conversation_messages m ON m.conversation_id = c.id
           WHERE c.user_id = $1
           ORDER BY c.created_at, c.id, m.id`,
          [userId]
        ),
        pool.query(
          `SELECT id, device_label, first_seen_at, last_seen_at, revoked_at, updated_at
           FROM account_devices
           WHERE user_id = $1
           ORDER BY first_seen_at, id`,
          [userId]
        ),
        pool.query(
          `SELECT e.id, e.event_type, e.severity, e.details, e.created_at,
                  d.device_label
           FROM account_security_events e
           LEFT JOIN account_devices d ON d.id = e.device_id
           WHERE e.user_id = $1
           ORDER BY e.created_at, e.id`,
          [userId]
        ),
        pool.query(
          `SELECT a.id, a.event_type, a.severity, a.title, a.message,
                  a.acknowledged_at, a.created_at, d.device_label
           FROM account_security_alerts a
           LEFT JOIN account_devices d ON d.id = a.device_id
           WHERE a.user_id = $1
           ORDER BY a.created_at, a.id`,
          [userId]
        ),
        pool.query(
          `SELECT id, label, transports, device_type, backed_up, created_at, last_used_at
           FROM account_passkeys
           WHERE user_id = $1
           ORDER BY created_at, id`,
          [userId]
        ),
        pool.query(
          `SELECT
             COUNT(*)::int AS total_records,
             COUNT(*) FILTER (WHERE used_at IS NULL)::int AS remaining,
             MAX(created_at) AS generated_at,
             MAX(used_at) AS last_used_at
           FROM account_recovery_codes
           WHERE user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT provider, model, event_type, input_tokens, output_tokens,
                  total_tokens, web_search_calls, estimated_cost_micros, created_at
           FROM usage_events
           WHERE user_id = $1
           ORDER BY created_at, id`,
          [userId]
        ),
        pool.query(
          `SELECT entitlement_key, enabled, reason, expires_at, created_at, updated_at
           FROM account_entitlement_overrides
           WHERE user_id = $1
           ORDER BY entitlement_key`,
          [userId]
        )
      ]);

      const accountRow = accountResult.rows[0];
      if (!accountRow) {
        return res.status(404).json({ error: "Account not found." });
      }

      const conversationMap = new Map();
      for (const row of conversationResult.rows) {
        const id = String(row.conversation_id);
        if (!conversationMap.has(id)) {
          conversationMap.set(id, {
            id,
            title: row.title || "New chat",
            depthStyle: normalizeDepthStyle(row.depth_style),
            productMode: normalizeProductMode(row.product_mode),
            createdAt: row.conversation_created_at,
            updatedAt: row.conversation_updated_at,
            messages: []
          });
        }
        if (row.message_id) {
          const content = String(row.message_content || "");
          const sources = row.message_role === "assistant"
            ? normalizeResearchSources(row.research_sources)
            : [];
          const citations = row.message_role === "assistant"
            ? normalizeResearchCitations(row.research_citations, sources, content.length)
            : [];
          conversationMap.get(id).messages.push({
            id: String(row.message_id),
            role: row.message_role,
            content,
            sources,
            citations,
            createdAt: row.message_created_at
          });
        }
      }

      const devices = deviceResult.rows.map((row) => ({
        id: String(row.id),
        label: row.device_label || "Unknown device",
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        revokedAt: row.revoked_at || null,
        updatedAt: row.updated_at
      }));

      const recoveryRow = recoveryResult.rows[0] || {};
      const exportPayload = buildDataExport({
        account: {
          id: String(accountRow.id),
          email: accountRow.email,
          displayName: accountRow.display_name,
          role: accountRow.role,
          planTier: accountRow.plan_tier,
          adultSelfConfirmedAt: accountRow.adult_confirmed_at,
          createdAt: accountRow.created_at,
          updatedAt: accountRow.updated_at
        },
        preferences,
        access,
        conversations: Array.from(conversationMap.values()),
        devices,
        securityEvents: securityEventResult.rows.map(publicSecurityEvent),
        securityAlerts: securityAlertResult.rows.map(publicSecurityAlert),
        passkeys: passkeyResult.rows.map(publicPasskey),
        recovery: {
          remaining: Number(recoveryRow.remaining || 0),
          totalRecords: Number(recoveryRow.total_records || 0),
          generatedAt: recoveryRow.generated_at || null,
          lastUsedAt: recoveryRow.last_used_at || null
        },
        usage: usageResult.rows.map((row) => ({
          provider: row.provider,
          model: row.model,
          eventType: row.event_type,
          inputTokens: Number(row.input_tokens || 0),
          outputTokens: Number(row.output_tokens || 0),
          totalTokens: Number(row.total_tokens || 0),
          webSearchCalls: Number(row.web_search_calls || 0),
          estimatedCostMicros: row.estimated_cost_micros === null
            ? null
            : Number(row.estimated_cost_micros),
          createdAt: row.created_at
        })),
        entitlementOverrides: overrideResult.rows.map((row) => ({
          key: row.entitlement_key,
          enabled: Boolean(row.enabled),
          reason: row.reason || null,
          expiresAt: row.expires_at || null,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }))
      });

      await writeSecurityEvent(
        pool,
        userId,
        "account.data_exported",
        null,
        { label: coarseDeviceLabel(req) }
      );

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${buildExportFilename()}"`
      );
      return res.send(JSON.stringify(exportPayload, null, 2));
    } catch (error) {
      console.error("UNBOUND AI DATA EXPORT ERROR:", error);
      return res.status(500).json({ error: "Could not build your UNBOUND AI data export." });
    }
  }
);


/* ----------------------- LEGAL CONSENT / POLICIES ---------------------- */

app.get(
  "/api/account/legal",
  requireDatabase,
  requireSignedIn,
  requireCapability("legal_consent"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT document_type, document_version, accepted_at
         FROM account_legal_acceptances
         WHERE user_id = $1
         ORDER BY accepted_at DESC, id DESC`,
        [req.user.id]
      );

      return res.json(buildLegalConsentStatus({ acceptedRows: result.rows }));
    } catch (error) {
      console.error("UNBOUND AI LEGAL STATUS ERROR:", error);
      return res.status(500).json({ error: "Could not load legal acceptance status." });
    }
  }
);

app.post(
  "/api/account/legal/accept",
  requireDatabase,
  requireSignedIn,
  requireCapability("legal_consent"),
  async (req, res) => {
    try {
      const documentType = normalizeLegalDocumentType(req.body?.documentType);
      const requestedVersion = String(req.body?.version || "").trim();
      const legalStatus = buildLegalConsentStatus();

      if (!legalStatus.acceptanceEnabled) {
        return res.status(503).json({
          error: "Legal acceptance is not enabled until final policy documents are published."
        });
      }

      const currentDocument = legalStatus.documents.find(
        (document) => document.type === documentType
      );

      if (!documentType || !currentDocument) {
        return res.status(400).json({ error: "Unknown legal document type." });
      }

      if (!requestedVersion || requestedVersion !== currentDocument.version) {
        return res.status(409).json({
          error: "That legal document version is no longer current.",
          currentVersion: currentDocument.version
        });
      }

      await pool.query(
        `INSERT INTO account_legal_acceptances
           (user_id, document_type, document_version)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, document_type, document_version) DO NOTHING`,
        [req.user.id, documentType, currentDocument.version]
      );

      await writeSecurityEvent(
        pool,
        req.user.id,
        "account.legal_accepted",
        null,
        {
          documentType,
          version: currentDocument.version
        }
      );

      const result = await pool.query(
        `SELECT document_type, document_version, accepted_at
         FROM account_legal_acceptances
         WHERE user_id = $1
         ORDER BY accepted_at DESC, id DESC`,
        [req.user.id]
      );

      return res.json(buildLegalConsentStatus({ acceptedRows: result.rows }));
    } catch (error) {
      console.error("UNBOUND AI LEGAL ACCEPT ERROR:", error);
      return res.status(500).json({ error: "Could not record legal acceptance." });
    }
  }
);

/* ------------------------- CONVERSATION HISTORY ------------------------ */

function conversationTitleFromMessage(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || "New chat").slice(0, 72);
}

function validConversationId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function normalizeResearchSources(value) {
  if (!Array.isArray(value)) return [];

  const results = [];
  const seen = new Set();

  for (const item of value) {
    if (results.length >= 12) break;

    try {
      const parsed = new URL(String(item?.url || ""));
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      const url = parsed.toString().slice(0, 2048);
      if (seen.has(url)) continue;
      seen.add(url);

      const number = Number(item?.number);
      results.push({
        number: Number.isInteger(number) && number > 0 ? number : results.length + 1,
        title: String(item?.title || "Source").trim().slice(0, 220) || "Source",
        url
      });
    } catch {
      continue;
    }
  }

  return results;
}

function normalizeResearchCitations(value, sources, contentLength = 12000) {
  if (!Array.isArray(value)) return [];
  const allowedNumbers = new Set(sources.map((source) => Number(source.number)));

  return value
    .map((item) => ({
      sourceNumber: Number(item?.sourceNumber),
      startIndex: Number(item?.startIndex),
      endIndex: Number(item?.endIndex)
    }))
    .filter((item) =>
      allowedNumbers.has(item.sourceNumber) &&
      Number.isInteger(item.startIndex) &&
      Number.isInteger(item.endIndex) &&
      item.startIndex >= 0 &&
      item.endIndex >= item.startIndex &&
      item.endIndex <= contentLength
    )
    .slice(0, 30);
}

function cleanStoredMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((item) =>
      item &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string" &&
      item.content.trim()
    )
    .map((item) => {
      const content = item.content.trim().slice(0, 12000);
      const sources = item.role === "assistant"
        ? normalizeResearchSources(item.sources)
        : [];
      const citations = item.role === "assistant"
        ? normalizeResearchCitations(item.citations, sources, content.length)
        : [];

      return {
        role: item.role,
        content,
        sources,
        citations
      };
    })
    .slice(-50);
}

function publicConversation(row) {
  return {
    id: String(row.id),
    title: row.title || "New chat",
    depthStyle: normalizeDepthStyle(row.depth_style),
    productMode: normalizeProductMode(row.product_mode),
    messageCount: Number(row.message_count || 0),
    preview: row.preview || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getConversationMessages(conversationId, limit = 200, client = pool) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const result = await client.query(
    `SELECT id, role, content, research_sources, research_citations, created_at
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY id DESC
     LIMIT $2`,
    [conversationId, safeLimit]
  );

  return result.rows.reverse().map((row) => {
    const content = String(row.content || "");
    const sources = row.role === "assistant"
      ? normalizeResearchSources(row.research_sources)
      : [];
    const citations = row.role === "assistant"
      ? normalizeResearchCitations(row.research_citations, sources, content.length)
      : [];

    return {
      id: String(row.id),
      role: row.role,
      content,
      sources,
      citations,
      createdAt: row.created_at
    };
  });
}

async function preparePersistentChat(req, message, depthStyle, productMode) {
  if (!databaseReady || !pool) {
    return null;
  }

  const user = await findSessionUser(req);
  if (!user) {
    return null;
  }

  const requestedId = String(req.body.conversationId || "").trim();
  if (requestedId && !validConversationId(requestedId)) {
    const error = new Error("Invalid conversation ID.");
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    let conversation;

    if (requestedId) {
      const result = await client.query(
        `SELECT id, user_id, title, depth_style, product_mode, created_at, updated_at
         FROM conversations
         WHERE id = $1 AND user_id = $2
         LIMIT 1
         FOR UPDATE`,
        [requestedId, user.id]
      );
      conversation = result.rows[0];

      if (!conversation) {
        const error = new Error("Conversation not found.");
        error.statusCode = 404;
        throw error;
      }
    } else {
      const result = await client.query(
        `INSERT INTO conversations (user_id, title, depth_style, product_mode)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, title, depth_style, product_mode, created_at, updated_at`,
        [user.id, conversationTitleFromMessage(message), depthStyle, productMode]
      );
      conversation = result.rows[0];
    }

    const priorResult = await client.query(
      `SELECT role, content
       FROM conversation_messages
       WHERE conversation_id = $1
       ORDER BY id DESC
       LIMIT 20`,
      [conversation.id]
    );
    const history = priorResult.rows.reverse().map((row) => ({
      role: row.role,
      content: row.content
    }));

    await client.query(
      `INSERT INTO conversation_messages (conversation_id, role, content)
       VALUES ($1, 'user', $2)`,
      [conversation.id, message.slice(0, 12000)]
    );

    const nextTitle =
      !conversation.title || conversation.title === "New chat"
        ? conversationTitleFromMessage(message)
        : conversation.title;

    await client.query(
      `UPDATE conversations
       SET title = $1,
           depth_style = $2,
           product_mode = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [nextTitle, depthStyle, productMode, conversation.id]
    );

    await client.query("COMMIT");

    return {
      user,
      conversationId: String(conversation.id),
      history
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function persistAssistantMessage(
  persistentChat,
  content,
  depthStyle,
  productMode,
  researchMetadata = {}
) {
  if (!persistentChat || !databaseReady || !pool) {
    return;
  }

  const text = String(content || "").trim().slice(0, 12000);
  if (!text) {
    return;
  }

  const sources = normalizeResearchSources(researchMetadata.sources);
  const citations = normalizeResearchCitations(
    researchMetadata.citations,
    sources,
    text.length
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO conversation_messages (
         conversation_id,
         role,
         content,
         research_sources,
         research_citations
       )
       VALUES ($1, 'assistant', $2, $3::jsonb, $4::jsonb)`,
      [
        persistentChat.conversationId,
        text,
        JSON.stringify(sources),
        JSON.stringify(citations)
      ]
    );
    await client.query(
      `UPDATE conversations
       SET depth_style = $1,
           product_mode = $2,
           updated_at = NOW()
       WHERE id = $3 AND user_id = $4`,
      [
        depthStyle,
        productMode,
        persistentChat.conversationId,
        persistentChat.user.id
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

app.get(
  "/api/conversations",
  requireDatabase,
  requireSignedIn,
  requireCapability("server_history"),
  async (req, res) => {
    try {
      const requestedLimit = Number.parseInt(String(req.query.limit || "50"), 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 100)
        : 50;

      const result = await pool.query(
        `SELECT
           c.id,
           c.title,
           c.depth_style,
           c.product_mode,
           c.created_at,
           c.updated_at,
           COUNT(m.id)::bigint AS message_count,
           COALESCE((
             SELECT cm.content
             FROM conversation_messages cm
             WHERE cm.conversation_id = c.id
             ORDER BY cm.id DESC
             LIMIT 1
           ), '') AS preview
         FROM conversations c
         LEFT JOIN conversation_messages m ON m.conversation_id = c.id
         WHERE c.user_id = $1
         GROUP BY c.id
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT $2`,
        [req.user.id, limit]
      );

      return res.json({
        conversations: result.rows.map(publicConversation)
      });
    } catch (error) {
      console.error("UNBOUND AI CONVERSATION LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load conversation history." });
    }
  }
);

app.get(
  "/api/conversations/:id",
  requireDatabase,
  requireSignedIn,
  requireCapability("server_history"),
  async (req, res) => {
    try {
      const conversationId = String(req.params.id || "").trim();
      if (!validConversationId(conversationId)) {
        return res.status(400).json({ error: "Invalid conversation ID." });
      }

      const result = await pool.query(
        `SELECT id, title, depth_style, product_mode, created_at, updated_at
         FROM conversations
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [conversationId, req.user.id]
      );
      const conversation = result.rows[0];

      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found." });
      }

      const messages = await getConversationMessages(conversation.id, 500);
      return res.json({
        conversation: publicConversation({
          ...conversation,
          message_count: messages.length,
          preview: messages[messages.length - 1]?.content || ""
        }),
        messages
      });
    } catch (error) {
      console.error("UNBOUND AI CONVERSATION LOAD ERROR:", error);
      return res.status(500).json({ error: "Could not load that conversation." });
    }
  }
);

app.post(
  "/api/conversations",
  requireDatabase,
  requireSignedIn,
  requireCapability("server_history"),
  async (req, res) => {
    try {
      const depthStyle = normalizeDepthStyle(req.body.depthStyle);
      const productMode = normalizeProductMode(req.body.productMode);
      const result = await pool.query(
        `INSERT INTO conversations (user_id, title, depth_style, product_mode)
         VALUES ($1, 'New chat', $2, $3)
         RETURNING id, title, depth_style, product_mode, created_at, updated_at`,
        [req.user.id, depthStyle, productMode]
      );
      return res.status(201).json({
        conversation: publicConversation({
          ...result.rows[0],
          message_count: 0,
          preview: ""
        })
      });
    } catch (error) {
      console.error("UNBOUND AI CONVERSATION CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not start a new conversation." });
    }
  }
);

app.post(
  "/api/conversations/import",
  requireDatabase,
  requireSignedIn,
  requireCapability("server_history"),
  async (req, res) => {
    const messages = cleanStoredMessages(req.body.messages).slice(-50);
    if (!messages.length) {
      return res.status(400).json({ error: "There is no conversation to import." });
    }

    const depthStyle = normalizeDepthStyle(req.body.depthStyle);
    const productMode = normalizeProductMode(req.body.productMode);
    const firstUser = messages.find((item) => item.role === "user");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const created = await client.query(
        `INSERT INTO conversations (user_id, title, depth_style, product_mode)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, depth_style, product_mode, created_at, updated_at`,
        [
          req.user.id,
          conversationTitleFromMessage(firstUser?.content || "Imported chat"),
          depthStyle,
          productMode
        ]
      );
      const conversation = created.rows[0];

      for (const item of messages) {
        await client.query(
          `INSERT INTO conversation_messages (
             conversation_id,
             role,
             content,
             research_sources,
             research_citations
           )
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
          [
            conversation.id,
            item.role,
            item.content,
            JSON.stringify(item.sources || []),
            JSON.stringify(item.citations || [])
          ]
        );
      }

      await client.query(
        `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
        [conversation.id]
      );
      await client.query("COMMIT");

      return res.status(201).json({
        conversation: publicConversation({
          ...conversation,
          message_count: messages.length,
          preview: messages[messages.length - 1]?.content || ""
        }),
        messages
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("UNBOUND AI CONVERSATION IMPORT ERROR:", error);
      return res.status(500).json({ error: "Could not import the existing conversation." });
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/conversations/:id",
  requireDatabase,
  requireSignedIn,
  requireCapability("server_history"),
  async (req, res) => {
    try {
      const conversationId = String(req.params.id || "").trim();
      if (!validConversationId(conversationId)) {
        return res.status(400).json({ error: "Invalid conversation ID." });
      }

      const result = await pool.query(
        `DELETE FROM conversations
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [conversationId, req.user.id]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ error: "Conversation not found." });
      }

      return res.json({ ok: true, id: conversationId });
    } catch (error) {
      console.error("UNBOUND AI CONVERSATION DELETE ERROR:", error);
      return res.status(500).json({ error: "Could not delete that conversation." });
    }
  }
);

function buildCurrentOperationalSnapshot() {
  const maintenance = getMaintenanceStatus();
  const ai = getGatewayStatus();
  const runtime = buildReadinessStatus({
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseReady,
    databaseError,
    shuttingDown,
    maintenanceStatus: maintenance,
    aiStatus: ai
  });
  const infrastructure = buildInfrastructureReadiness();
  const recovery = buildRecoveryReadiness();
  const legal = legalPublishingState();
  const billing = getBillingGatewayStatus();
  const ageVerification = getAgeVerificationGatewayStatus();
  const launch = buildLaunchReadiness({
    runtime,
    maintenance,
    infrastructure,
    recovery,
    legal,
    billing,
    ageVerification,
    ai
  });

  return {
    runtime,
    maintenance,
    infrastructure,
    recovery,
    legal,
    billing,
    ageVerification,
    ai,
    launch,
    http: getRequestObservabilitySnapshot()
  };
}

app.post(
  BILLING_WEBHOOK_PATH,
  requireDatabase,
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");
    let event;

    try {
      event = await processBillingWebhook({
        rawBody,
        headers: req.headers,
        requestId: req.requestId || null
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("BILLING_")) {
        return res.status(Number(error.statusCode) || 400).json({
          error: error.publicMessage || "Billing webhook rejected.",
          code: error.code
        });
      }
      console.error("UNBOUND AI BILLING WEBHOOK VERIFY ERROR:", error);
      return res.status(500).json({ error: "Could not process billing webhook." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const eventInsert = await client.query(
        `INSERT INTO billing_webhook_events (
           provider, provider_event_id, event_type, status, payload_sha256, received_at
         )
         VALUES ($1, $2, $3, 'received', $4, NOW())
         ON CONFLICT (provider, provider_event_id) DO NOTHING
         RETURNING id`,
        [event.provider, event.providerEventId, event.eventType, payloadSha256]
      );

      if (!eventInsert.rows[0]) {
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, duplicate: true });
      }

      const eventRowId = eventInsert.rows[0].id;
      const subscriptionResult = await client.query(
        `SELECT id, user_id, provider_customer_id, provider_subscription_id,
                status, plan_tier, current_period_start, current_period_end,
                cancel_at_period_end, last_event_at
         FROM account_subscriptions
         WHERE provider = $1 AND billing_subject_hash = $2
         LIMIT 1
         FOR UPDATE`,
        [event.provider, event.subject]
      );
      const subscription = subscriptionResult.rows[0] || null;

      if (!subscription) {
        await client.query(
          `UPDATE billing_webhook_events
           SET status = 'failed', error_text = 'billing-subject-not-found', processed_at = NOW()
           WHERE id = $1`,
          [eventRowId]
        );
        await client.query("COMMIT");
        return res.status(202).json({ ok: true, accepted: true });
      }

      const eventTime = new Date(event.occurredAt).getTime();
      const lastEventTime = subscription.last_event_at
        ? new Date(subscription.last_event_at).getTime()
        : 0;
      if (Number.isFinite(lastEventTime) && lastEventTime > eventTime) {
        await client.query(
          `UPDATE billing_webhook_events
           SET status = 'processed', error_text = 'ignored-stale-event', processed_at = NOW()
           WHERE id = $1`,
          [eventRowId]
        );
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, ignored: true, reason: "stale-event" });
      }

      if (event.providerSubscriptionId) {
        const conflicting = await client.query(
          `SELECT user_id FROM account_subscriptions
           WHERE provider = $1 AND provider_subscription_id = $2 AND user_id <> $3
           LIMIT 1`,
          [event.provider, event.providerSubscriptionId, subscription.user_id]
        );
        if (conflicting.rows[0]) {
          await client.query(
            `UPDATE billing_webhook_events
             SET status = 'failed', error_text = 'provider-subscription-conflict', processed_at = NOW()
             WHERE id = $1`,
            [eventRowId]
          );
          await client.query("COMMIT");
          return res.status(409).json({ ok: false, error: "Billing subscription mapping conflict." });
        }
      }

      await client.query(
        `UPDATE account_subscriptions
         SET provider_customer_id = COALESCE($2, provider_customer_id),
             provider_subscription_id = COALESCE($3, provider_subscription_id),
             status = $4,
             plan_tier = $5,
             current_period_start = COALESCE($6, current_period_start),
             current_period_end = COALESCE($7, current_period_end),
             cancel_at_period_end = $8,
             last_event_at = $9,
             updated_at = NOW()
         WHERE user_id = $1`,
        [
          subscription.user_id,
          event.providerCustomerId,
          event.providerSubscriptionId,
          event.status,
          event.planTier,
          event.currentPeriodStart,
          event.currentPeriodEnd,
          event.cancelAtPeriodEnd,
          event.occurredAt
        ]
      );

      await client.query(
        `UPDATE billing_webhook_events
         SET status = 'processed', error_text = NULL, processed_at = NOW()
         WHERE id = $1`,
        [eventRowId]
      );

      await client.query("COMMIT");
      return res.status(200).json({
        ok: true,
        processed: true,
        status: event.status,
        planTier: event.planTier
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI BILLING WEBHOOK DATABASE ERROR:", error);
      return res.status(500).json({ error: "Could not persist billing webhook." });
    } finally {
      client.release();
    }
  }
);

app.post(
  AGE_VERIFICATION_WEBHOOK_PATH,
  requireDatabase,
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");
    let event;

    try {
      event = await processAgeVerificationWebhook({
        rawBody,
        headers: req.headers,
        requestId: req.requestId || null
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("AGE_VERIFICATION_")) {
        return res.status(Number(error.statusCode) || 400).json({
          error: error.publicMessage || "Age-verification webhook rejected.",
          code: error.code
        });
      }
      console.error("UNBOUND AI AGE VERIFICATION WEBHOOK VERIFY ERROR:", error);
      return res.status(500).json({ error: "Could not process age-verification webhook." });
    }

    const providerReferenceHash = hashAgeVerificationReference(event.providerReference);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const eventInsert = await client.query(
        `INSERT INTO age_verification_events (
           provider,
           provider_event_id,
           event_type,
           status,
           payload_sha256,
           received_at
         )
         VALUES ($1, $2, $3, 'received', $4, NOW())
         ON CONFLICT (provider, provider_event_id) DO NOTHING
         RETURNING id`,
        [event.provider, event.providerEventId, event.eventType, payloadSha256]
      );

      if (!eventInsert.rows[0]) {
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, duplicate: true });
      }

      const eventRowId = eventInsert.rows[0].id;
      const accountResult = await client.query(
        `SELECT user_id, status, verified_at, expires_at, last_event_at
         FROM account_age_verification
         WHERE provider = $1
           AND provider_reference_hash = $2
         LIMIT 1
         FOR UPDATE`,
        [event.provider, providerReferenceHash]
      );
      const account = accountResult.rows[0] || null;

      if (!account) {
        await client.query(
          `UPDATE age_verification_events
           SET status = 'failed',
               error_text = 'verification-reference-not-found',
               processed_at = NOW()
           WHERE id = $1`,
          [eventRowId]
        );
        await client.query("COMMIT");
        return res.status(202).json({ ok: true, accepted: true });
      }

      const eventTime = new Date(event.occurredAt).getTime();
      const lastEventTime = account.last_event_at
        ? new Date(account.last_event_at).getTime()
        : 0;
      if (Number.isFinite(lastEventTime) && lastEventTime > eventTime) {
        await client.query(
          `UPDATE age_verification_events
           SET user_id = $2,
               status = 'processed',
               error_text = 'ignored-stale-event',
               processed_at = NOW()
           WHERE id = $1`,
          [eventRowId, account.user_id]
        );
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, ignored: true, reason: "stale-event" });
      }

      const transition = resolveAgeVerificationTransition(account.status, event.status);
      if (!transition.apply) {
        await client.query(
          `UPDATE age_verification_events
           SET user_id = $2,
               status = 'processed',
               error_text = $3,
               processed_at = NOW()
           WHERE id = $1`,
          [eventRowId, account.user_id, transition.reason || "transition-not-applied"]
        );
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, ignored: true, reason: transition.reason || "transition-not-applied" });
      }

      const nextVerifiedAt = event.status === "verified"
        ? event.verifiedAt
        : account.verified_at;
      const nextExpiresAt = event.expiresAt || account.expires_at;

      await client.query(
        `UPDATE account_age_verification
         SET status = $2,
             age_threshold = 18,
             verified_at = $3,
             expires_at = $4,
             result_code = $5,
             last_event_at = $6,
             updated_at = NOW()
         WHERE user_id = $1`,
        [
          account.user_id,
          transition.status,
          nextVerifiedAt,
          nextExpiresAt,
          event.resultCode,
          event.occurredAt
        ]
      );

      await client.query(
        `UPDATE age_verification_events
         SET user_id = $2,
             status = 'processed',
             error_text = NULL,
             processed_at = NOW()
         WHERE id = $1`,
        [eventRowId, account.user_id]
      );

      await client.query("COMMIT");
      return res.status(200).json({
        ok: true,
        processed: true,
        status: transition.status
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI AGE VERIFICATION WEBHOOK DATABASE ERROR:", error);
      return res.status(500).json({ error: "Could not persist age-verification webhook." });
    } finally {
      client.release();
    }
  }
);

/* -------------------------- ADVERTISING --------------------------- */

function advertisingReturnUrl(req, result) {
  let origin = String(process.env.PUBLIC_APP_ORIGIN || "").trim();
  try {
    if (origin) {
      const parsed = new URL(origin);
      origin = parsed.protocol === "https:" ? parsed.origin : "";
    }
  } catch (_) {
    origin = "";
  }
  if (!origin) {
    const host = req.get("host");
    if (!host) return null;
    origin = `${IS_PRODUCTION ? "https" : req.protocol}://${host}`;
  }
  if (!origin.startsWith("https://")) return null;
  return `${origin}/advertisers.html?payment=${encodeURIComponent(result)}`;
}

app.get("/api/advertising/catalog", requireDatabase, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT business_name, website_url, headline, description, featured, ends_at
       FROM advertising_orders
       WHERE payment_status = 'paid'
         AND review_status = 'approved'
         AND starts_at IS NOT NULL
         AND ends_at IS NOT NULL
         AND starts_at <= NOW()
         AND ends_at > NOW()
       ORDER BY featured DESC, starts_at DESC
       LIMIT 100`
    );

    return res.json({
      packages: advertisingPackages(),
      payment: getAdvertisingPaymentStatus(),
      ads: result.rows.map((row) => ({
        businessName: row.business_name,
        websiteUrl: row.website_url,
        headline: row.headline,
        description: row.description,
        featured: Boolean(row.featured),
        endsAt: row.ends_at
      }))
    });
  } catch (error) {
    console.error("UNBOUND AI ADVERTISING CATALOG ERROR:", error);
    return res.status(500).json({ error: "Could not load advertising." });
  }
});

app.post("/api/advertising/orders", requireDatabase, registerRateLimit, async (req, res) => {
  const packageDefinition = getAdvertisingPackage(req.body?.packageCode);
  const creative = normalizeAdvertisingCreative(req.body);
  const payment = getAdvertisingPaymentStatus();

  if (!packageDefinition || !creative) {
    return res.status(400).json({
      error: "Choose a valid advertising package and complete all advertiser fields. HTTPS website URLs are required."
    });
  }
  if (!(payment.configured && payment.checkout && payment.webhooks)) {
    return res.status(503).json({
      error: "Advertising checkout is not connected yet. Payment processing must be configured before orders can be purchased."
    });
  }

  const subject = crypto.randomBytes(32).toString("hex");
  const subjectHash = crypto.createHash("sha256").update(subject).digest("hex");
  let orderId = null;

  try {
    const inserted = await pool.query(
      `INSERT INTO advertising_orders (
         subject_hash, package_code, package_name, amount_cents, currency,
         duration_days, featured, business_name, contact_email, website_url,
         headline, description, payment_provider, payment_status, review_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending','pending')
       RETURNING id`,
      [
        subjectHash,
        packageDefinition.code,
        packageDefinition.name,
        packageDefinition.amountCents,
        packageDefinition.currency,
        packageDefinition.durationDays,
        packageDefinition.featured,
        creative.businessName,
        creative.contactEmail,
        creative.websiteUrl,
        creative.headline,
        creative.description,
        payment.provider
      ]
    );
    orderId = inserted.rows[0].id;

    const checkout = await startAdvertisingCheckout({
      subject,
      email: creative.contactEmail,
      packageCode: packageDefinition.code,
      amountCents: packageDefinition.amountCents,
      currency: packageDefinition.currency,
      successUrl: advertisingReturnUrl(req, "success"),
      cancelUrl: advertisingReturnUrl(req, "canceled"),
      requestId: req.requestId
    });

    return res.status(201).json({
      orderId,
      checkoutUrl: checkout.checkoutUrl,
      expiresAt: checkout.expiresAt
    });
  } catch (error) {
    if (orderId) {
      await pool.query(
        `UPDATE advertising_orders
         SET payment_status = 'failed', updated_at = NOW()
         WHERE id = $1 AND payment_status = 'pending'`,
        [orderId]
      ).catch(() => {});
    }
    console.error("UNBOUND AI ADVERTISING CHECKOUT ERROR:", error);
    return res.status(error?.statusCode || 500).json({
      error: error?.publicMessage || "Could not start advertising checkout."
    });
  }
});

app.post(ADVERTISING_WEBHOOK_PATH, requireDatabase, async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");
  let event;

  try {
    event = await processAdvertisingWebhook({
      rawBody,
      headers: req.headers,
      requestId: req.requestId
    });
  } catch (error) {
    console.error("UNBOUND AI ADVERTISING WEBHOOK ERROR:", error?.message || error);
    return res.status(error?.statusCode || 400).json({
      error: error?.publicMessage || "Advertising payment webhook rejected."
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO advertising_payment_events (
         provider, provider_event_id, event_type, payment_status,
         payload_sha256, status, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,'received',$6)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [
        event.provider,
        event.providerEventId,
        event.eventType,
        event.paymentStatus,
        payloadSha256,
        event.occurredAt
      ]
    );

    if (!inserted.rows[0]) {
      await client.query("ROLLBACK");
      return res.json({ ok: true, duplicate: true });
    }

    const subjectHash = crypto.createHash("sha256").update(event.subject).digest("hex");
    const orderResult = await client.query(
      `SELECT id, last_event_at
       FROM advertising_orders
       WHERE subject_hash = $1
       FOR UPDATE`,
      [subjectHash]
    );
    const order = orderResult.rows[0];

    if (!order) {
      await client.query(
        `UPDATE advertising_payment_events
         SET status = 'ignored', error_text = 'unknown-order', processed_at = NOW()
         WHERE id = $1`,
        [inserted.rows[0].id]
      );
      await client.query("COMMIT");
      return res.status(202).json({ ok: true, ignored: true });
    }

    if (order.last_event_at && new Date(event.occurredAt) <= new Date(order.last_event_at)) {
      await client.query(
        `UPDATE advertising_payment_events
         SET order_id = $1, status = 'ignored', error_text = 'ignored-stale-event', processed_at = NOW()
         WHERE id = $2`,
        [order.id, inserted.rows[0].id]
      );
      await client.query("COMMIT");
      return res.json({ ok: true, ignored: true });
    }

    await client.query(
      `UPDATE advertising_orders
       SET payment_provider = $1,
           payment_status = $2,
           last_event_at = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [event.provider, event.paymentStatus, event.occurredAt, order.id]
    );
    await client.query(
      `UPDATE advertising_payment_events
       SET order_id = $1, status = 'processed', processed_at = NOW()
       WHERE id = $2`,
      [order.id, inserted.rows[0].id]
    );
    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("UNBOUND AI ADVERTISING WEBHOOK DATABASE ERROR:", error);
    return res.status(500).json({ error: "Could not process advertising payment event." });
  } finally {
    client.release();
  }
});

app.get("/api/admin/advertising/orders", requireDatabase, requireAdmin, async (req, res) => {
  const reviewStatus = String(req.query.reviewStatus || "").trim().toLowerCase();
  const allowedReview = new Set(["pending", "approved", "rejected"]);
  const values = [];
  let where = "";
  if (allowedReview.has(reviewStatus)) {
    values.push(reviewStatus);
    where = "WHERE review_status = $1";
  }

  try {
    const result = await pool.query(
      `SELECT id, package_code, package_name, amount_cents, currency, duration_days,
              featured, business_name, contact_email, website_url, headline, description,
              payment_status, review_status, reviewed_at, starts_at, ends_at, created_at
       FROM advertising_orders
       ${where}
       ORDER BY created_at DESC
       LIMIT 500`,
      values
    );

    return res.json({
      orders: result.rows.map((row) => ({
        id: row.id,
        packageCode: row.package_code,
        packageName: row.package_name,
        amountCents: row.amount_cents,
        currency: row.currency,
        durationDays: row.duration_days,
        featured: Boolean(row.featured),
        businessName: row.business_name,
        contactEmail: row.contact_email,
        websiteUrl: row.website_url,
        headline: row.headline,
        description: row.description,
        paymentStatus: row.payment_status,
        reviewStatus: row.review_status,
        reviewedAt: row.reviewed_at,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    console.error("UNBOUND AI ADVERTISING ADMIN LIST ERROR:", error);
    return res.status(500).json({ error: "Could not load advertiser orders." });
  }
});

app.post("/api/admin/advertising/orders/:id/review", requireDatabase, requireAdmin, async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);
  const action = String(req.body?.action || "").trim().toLowerCase();
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "Advertising review request is invalid." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, payment_status, review_status, duration_days, starts_at, ends_at
       FROM advertising_orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId]
    );
    const order = result.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Advertiser order was not found." });
    }

    if (action === "approve" && order.payment_status !== "paid") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only paid advertiser orders can be approved." });
    }

    if (action === "approve") {
      await client.query(
        `UPDATE advertising_orders
         SET review_status = 'approved',
             reviewed_by_user_id = $1,
             reviewed_at = NOW(),
             starts_at = COALESCE(starts_at, NOW()),
             ends_at = COALESCE(ends_at, NOW() + (duration_days * INTERVAL '1 day')),
             updated_at = NOW()
         WHERE id = $2`,
        [req.user.id, orderId]
      );
    } else {
      await client.query(
        `UPDATE advertising_orders
         SET review_status = 'rejected',
             reviewed_by_user_id = $1,
             reviewed_at = NOW(),
             starts_at = NULL,
             ends_at = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [req.user.id, orderId]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true, reviewStatus: action === "approve" ? "approved" : "rejected" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("UNBOUND AI ADVERTISING REVIEW ERROR:", error);
    return res.status(500).json({ error: "Could not review advertiser order." });
  } finally {
    client.release();
  }
});

/* ----------------------------- ADMIN API ----------------------------- */

app.get(
  "/api/admin/ops/recovery",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    return res.json({
      recovery: buildRecoveryReadiness()
    });
  }
);

app.get(
  "/api/admin/ops/maintenance",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    return res.json({
      maintenance: getMaintenanceStatus()
    });
  }
);

app.get(
  "/api/admin/ops/launch-readiness",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    const snapshot = buildCurrentOperationalSnapshot();
    return res.json({ launch: snapshot.launch });
  }
);

app.get(
  "/api/admin/ops/status",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    return res.json(buildCurrentOperationalSnapshot());
  }
);

app.get(
  "/api/admin/entitlements/catalog",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    return res.json({
      capabilities: Object.entries(CAPABILITY_CATALOG).map(([key, item]) => ({
        key,
        label: item.label,
        description: item.description,
        implemented: Boolean(item.implemented),
        minimumPlan: normalizePlanTier(item.minimumPlan)
      }))
    });
  }
);

async function loadAdminTargetUser(userId, client = pool) {
  const result = await client.query(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.role,
       u.plan_tier,
       u.created_at,
       EXISTS (
         SELECT 1
         FROM complimentary_top_tier_grants g
         WHERE g.user_id = u.id
       ) AS complimentary_top_tier
     FROM users u
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

function publicEntitlementOverride(row) {
  const active =
    !row.expires_at || new Date(row.expires_at).getTime() > Date.now();

  return {
    key: row.entitlement_key,
    active,
    enabled: Boolean(row.enabled),
    reason: row.reason || null,
    expiresAt: row.expires_at || null,
    createdByAdminUserId:
      row.created_by_admin_user_id === null
        ? null
        : String(row.created_by_admin_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadAdminUserAccessPayload(userId) {
  const user = await loadAdminTargetUser(userId);
  if (!user) return null;

  const [access, overrideResult] = await Promise.all([
    buildAccountAccess(user),
    pool.query(
      `SELECT
         entitlement_key,
         enabled,
         reason,
         expires_at,
         created_by_admin_user_id,
         created_at,
         updated_at
       FROM account_entitlement_overrides
       WHERE user_id = $1
       ORDER BY entitlement_key`,
      [user.id]
    )
  ]);

  return {
    user: publicUser(user),
    access,
    overrides: overrideResult.rows.map(publicEntitlementOverride)
  };
}

app.get(
  "/api/admin/users/:id/access",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const userId = String(req.params.id || "").trim();
      if (!/^\d+$/.test(userId)) {
        return res.status(400).json({ error: "Invalid user ID." });
      }

      const payload = await loadAdminUserAccessPayload(userId);
      if (!payload) {
        return res.status(404).json({ error: "User not found." });
      }
      return res.json(payload);
    } catch (error) {
      console.error("UNBOUND AI ADMIN ACCESS DETAIL ERROR:", error);
      return res.status(500).json({ error: "Could not load user access details." });
    }
  }
);

app.put(
  "/api/admin/users/:id/entitlements/:key",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    const userId = String(req.params.id || "").trim();
    const entitlementKey = String(req.params.key || "").trim();
    const enabled = req.body.enabled;
    const reason =
      typeof req.body.reason === "string" ? req.body.reason.trim().slice(0, 300) : "";
    const expiresAtRaw = req.body.expiresAt;

    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }
    if (!isKnownCapability(entitlementKey)) {
      return res.status(400).json({ error: "Unknown capability." });
    }
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be true or false." });
    }

    let expiresAt = null;
    if (expiresAtRaw !== null && expiresAtRaw !== undefined && String(expiresAtRaw).trim()) {
      const parsed = new Date(expiresAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "Invalid expiration date." });
      }
      if (parsed.getTime() <= Date.now()) {
        return res.status(400).json({ error: "Expiration must be in the future." });
      }
      expiresAt = parsed.toISOString();
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await loadAdminTargetUser(userId, client);
      if (!target) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "User not found." });
      }

      const previousResult = await client.query(
        `SELECT entitlement_key, enabled, reason, expires_at
         FROM account_entitlement_overrides
         WHERE user_id = $1 AND entitlement_key = $2
         LIMIT 1`,
        [userId, entitlementKey]
      );
      const previous = previousResult.rows[0] || null;

      await client.query(
        `INSERT INTO account_entitlement_overrides (
           user_id,
           entitlement_key,
           enabled,
           reason,
           expires_at,
           created_by_admin_user_id,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (user_id, entitlement_key)
         DO UPDATE SET
           enabled = EXCLUDED.enabled,
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           created_by_admin_user_id = EXCLUDED.created_by_admin_user_id,
           updated_at = NOW()`,
        [
          userId,
          entitlementKey,
          enabled,
          reason || null,
          expiresAt,
          req.adminUser.id
        ]
      );

      await writeAdminAudit(
        client,
        req.adminUser,
        "user.entitlement_override.set",
        target,
        {
          entitlementKey,
          enabled,
          reason: reason || null,
          expiresAt,
          previous: previous
            ? {
                enabled: Boolean(previous.enabled),
                reason: previous.reason || null,
                expiresAt: previous.expires_at || null
              }
            : null
        }
      );

      await client.query("COMMIT");
      const payload = await loadAdminUserAccessPayload(userId);
      return res.json(payload);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI ADMIN ENTITLEMENT SET ERROR:", error);
      return res.status(500).json({ error: "Could not save capability override." });
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/admin/users/:id/entitlements/:key",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    const userId = String(req.params.id || "").trim();
    const entitlementKey = String(req.params.key || "").trim();

    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }
    if (!isKnownCapability(entitlementKey)) {
      return res.status(400).json({ error: "Unknown capability." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await loadAdminTargetUser(userId, client);
      if (!target) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "User not found." });
      }

      const deleted = await client.query(
        `DELETE FROM account_entitlement_overrides
         WHERE user_id = $1 AND entitlement_key = $2
         RETURNING entitlement_key, enabled, reason, expires_at`,
        [userId, entitlementKey]
      );

      if (deleted.rows[0]) {
        await writeAdminAudit(
          client,
          req.adminUser,
          "user.entitlement_override.cleared",
          target,
          {
            entitlementKey,
            previous: {
              enabled: Boolean(deleted.rows[0].enabled),
              reason: deleted.rows[0].reason || null,
              expiresAt: deleted.rows[0].expires_at || null
            }
          }
        );
      }

      await client.query("COMMIT");
      const payload = await loadAdminUserAccessPayload(userId);
      return res.json({
        cleared: Boolean(deleted.rows[0]),
        ...payload
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI ADMIN ENTITLEMENT CLEAR ERROR:", error);
      return res.status(500).json({ error: "Could not clear capability override." });
    } finally {
      client.release();
    }
  }
);







app.get(
  "/api/admin/rate-limits/summary",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const [bucketResult, blockTotalResult, blockScopesResult] = await Promise.all([
        pool.query(`
          SELECT scope, subject_kind, COUNT(*)::int AS buckets
          FROM rate_limit_buckets
          WHERE updated_at >= NOW() - INTERVAL '24 hours'
          GROUP BY scope, subject_kind
          ORDER BY buckets DESC, scope, subject_kind
        `),
        pool.query(`
          SELECT COUNT(*)::int AS blocks
          FROM rate_limit_blocks
          WHERE created_at >= NOW() - INTERVAL '24 hours'
        `),
        pool.query(`
          SELECT scope, subject_kind, COUNT(*)::int AS blocks
          FROM rate_limit_blocks
          WHERE created_at >= NOW() - INTERVAL '24 hours'
          GROUP BY scope, subject_kind
          ORDER BY blocks DESC, scope, subject_kind
        `)
      ]);

      return res.json({
        status: getRateLimitStatus(),
        totals: {
          blocks24h: Number(blockTotalResult.rows[0]?.blocks || 0),
          activeBuckets24h: bucketResult.rows.reduce(
            (sum, row) => sum + Number(row.buckets || 0),
            0
          )
        },
        activeBuckets: bucketResult.rows.map((row) => ({
          scope: row.scope,
          subjectKind: row.subject_kind,
          buckets: Number(row.buckets || 0)
        })),
        blocks: blockScopesResult.rows.map((row) => ({
          scope: row.scope,
          subjectKind: row.subject_kind,
          blocks: Number(row.blocks || 0)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI ADMIN RATE LIMIT SUMMARY ERROR:", error);
      return res.status(500).json({ error: "Could not load abuse-protection status." });
    }
  }
);

app.get(
  "/api/admin/security/summary",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const requested = Number(req.query.days || 30);
      const days = Math.min(Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 30, 1), 90);
      const [eventTotalsResult, eventTypesResult, deviceResult, sessionResult] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*)::int AS events,
             COUNT(*) FILTER (WHERE severity = 'warning')::int AS warnings
           FROM account_security_events
           WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
          [days]
        ),
        pool.query(
          `SELECT event_type, severity, COUNT(*)::int AS events
           FROM account_security_events
           WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
           GROUP BY event_type, severity
           ORDER BY events DESC, event_type, severity`,
          [days]
        ),
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE revoked_at IS NULL)::int AS active_devices,
            COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked_devices
          FROM account_devices
        `),
        pool.query(`
          SELECT COUNT(*)::int AS active_sessions
          FROM user_sessions
          WHERE expires_at > NOW()
        `)
      ]);

      const eventTotals = eventTotalsResult.rows[0] || {};
      const devices = deviceResult.rows[0] || {};
      const sessions = sessionResult.rows[0] || {};
      return res.json({
        days,
        totals: {
          events: Number(eventTotals.events || 0),
          warnings: Number(eventTotals.warnings || 0),
          activeDevices: Number(devices.active_devices || 0),
          revokedDevices: Number(devices.revoked_devices || 0),
          activeSessions: Number(sessions.active_sessions || 0)
        },
        eventTypes: eventTypesResult.rows.map((row) => ({
          eventType: row.event_type,
          severity: row.severity || "info",
          events: Number(row.events || 0)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI ADMIN SECURITY SUMMARY ERROR:", error);
      return res.status(500).json({ error: "Could not load security operations summary." });
    }
  }
);

app.get(
  "/api/admin/age-verification/summary",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const [totalsResult, groupedResult, eventResult] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)::int AS records,
            COUNT(*) FILTER (
              WHERE status = 'verified'
                AND (expires_at IS NULL OR expires_at > NOW())
            )::int AS verified_active,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (
              WHERE status IN ('expired', 'revoked')
                 OR (status = 'verified' AND expires_at IS NOT NULL AND expires_at <= NOW())
            )::int AS unavailable
          FROM account_age_verification
        `),
        pool.query(`
          SELECT
            COALESCE(NULLIF(provider, ''), 'unassigned') AS provider,
            status,
            COUNT(*)::int AS records
          FROM account_age_verification
          GROUP BY COALESCE(NULLIF(provider, ''), 'unassigned'), status
          ORDER BY records DESC, provider, status
        `),
        pool.query(`
          SELECT
            COUNT(*)::int AS events_30d,
            COUNT(*) FILTER (WHERE status = 'processed')::int AS processed_30d,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_30d
          FROM age_verification_events
          WHERE received_at >= NOW() - INTERVAL '30 days'
        `)
      ]);

      const totals = totalsResult.rows[0] || {};
      const events = eventResult.rows[0] || {};
      return res.json({
        gateway: getAgeVerificationGatewayStatus(),
        totals: {
          records: Number(totals.records || 0),
          verifiedActive: Number(totals.verified_active || 0),
          pending: Number(totals.pending || 0),
          unavailable: Number(totals.unavailable || 0),
          events30d: Number(events.events_30d || 0),
          processed30d: Number(events.processed_30d || 0),
          failed30d: Number(events.failed_30d || 0)
        },
        records: groupedResult.rows.map((row) => ({
          provider: row.provider,
          status: normalizeAgeVerificationStatus(row.status),
          count: Number(row.records || 0)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI ADMIN AGE VERIFICATION SUMMARY ERROR:", error);
      return res.status(500).json({ error: "Could not load age-verification status." });
    }
  }
);

app.get(
  "/api/admin/billing/summary",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const [totalsResult, subscriptionsResult, webhookResult] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)::int AS records,
            COUNT(*) FILTER (WHERE LOWER(status) IN ('active', 'trialing'))::int AS active_or_trialing,
            COUNT(*) FILTER (WHERE cancel_at_period_end IS TRUE)::int AS cancel_at_period_end
          FROM account_subscriptions
        `),
        pool.query(`
          SELECT
            COALESCE(NULLIF(provider, ''), 'unassigned') AS provider,
            status,
            plan_tier,
            COUNT(*)::int AS records
          FROM account_subscriptions
          GROUP BY COALESCE(NULLIF(provider, ''), 'unassigned'), status, plan_tier
          ORDER BY records DESC, provider, status, plan_tier
        `),
        pool.query(`
          SELECT
            COUNT(*)::int AS events_30d,
            COUNT(*) FILTER (WHERE status = 'processed')::int AS processed_30d,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_30d
          FROM billing_webhook_events
          WHERE received_at >= NOW() - INTERVAL '30 days'
        `)
      ]);

      const totals = totalsResult.rows[0] || {};
      const webhookTotals = webhookResult.rows[0] || {};

      return res.json({
        gateway: getBillingGatewayStatus(),
        totals: {
          subscriptionRecords: Number(totals.records || 0),
          activeOrTrialing: Number(totals.active_or_trialing || 0),
          cancelAtPeriodEnd: Number(totals.cancel_at_period_end || 0),
          webhookEvents30d: Number(webhookTotals.events_30d || 0),
          webhookProcessed30d: Number(webhookTotals.processed_30d || 0),
          webhookFailed30d: Number(webhookTotals.failed_30d || 0)
        },
        subscriptions: subscriptionsResult.rows.map((row) => ({
          provider: row.provider,
          status: normalizeSubscriptionStatus(row.status),
          rawStatus: row.status,
          planTier: normalizePlanTier(row.plan_tier),
          records: Number(row.records || 0)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI ADMIN BILLING SUMMARY ERROR:", error);
      return res.status(500).json({ error: "Could not load billing foundation status." });
    }
  }
);

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

app.get(
  "/api/admin/audit",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const requestedLimit = Number.parseInt(String(req.query.limit || "100"), 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 250)
        : 100;

      const result = await pool.query(
        `SELECT
           id,
           admin_user_id,
           admin_email,
           action,
           target_user_id,
           target_email,
           details,
           created_at
         FROM admin_audit_log
         ORDER BY created_at DESC, id DESC
         LIMIT $1`,
        [limit]
      );

      return res.json({
        events: result.rows.map((event) => ({
          id: String(event.id),
          adminUserId:
            event.admin_user_id === null ? null : String(event.admin_user_id),
          adminEmail: event.admin_email,
          action: event.action,
          targetUserId:
            event.target_user_id === null ? null : String(event.target_user_id),
          targetEmail: event.target_email,
          details: event.details || {},
          createdAt: event.created_at
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI ADMIN AUDIT ERROR:", error);
      return res.status(500).json({
        error: "Could not load the administrator audit log."
      });
    }
  }
);

app.get(
  "/api/admin/usage/summary",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const requestedDays = Number.parseInt(String(req.query.days || "30"), 10);
      const days = Number.isFinite(requestedDays)
        ? Math.min(Math.max(requestedDays, 1), 365)
        : 30;

      const [totalsResult, modelResult, dailyResult] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*)::bigint AS requests,
             COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
             COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
             COALESCE(SUM(web_search_calls), 0)::bigint AS web_search_calls,
             COUNT(estimated_cost_micros)::bigint AS priced_events,
             COALESCE(SUM(estimated_cost_micros), 0)::bigint AS estimated_cost_micros
           FROM usage_events
           WHERE created_at >= NOW() - ($1::text || ' days')::interval`,
          [days]
        ),
        pool.query(
          `SELECT
             provider,
             model,
             COUNT(*)::bigint AS requests,
             COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
             COALESCE(SUM(web_search_calls), 0)::bigint AS web_search_calls,
             COUNT(estimated_cost_micros)::bigint AS priced_events,
             COALESCE(SUM(estimated_cost_micros), 0)::bigint AS estimated_cost_micros
           FROM usage_events
           WHERE created_at >= NOW() - ($1::text || ' days')::interval
           GROUP BY provider, model
           ORDER BY total_tokens DESC
           LIMIT 20`,
          [days]
        ),
        pool.query(
          `SELECT
             DATE_TRUNC('day', created_at) AS day,
             COUNT(*)::bigint AS requests,
             COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
             COALESCE(SUM(web_search_calls), 0)::bigint AS web_search_calls,
             COUNT(estimated_cost_micros)::bigint AS priced_events,
             COALESCE(SUM(estimated_cost_micros), 0)::bigint AS estimated_cost_micros
           FROM usage_events
           WHERE created_at >= NOW() - ($1::text || ' days')::interval
           GROUP BY DATE_TRUNC('day', created_at)
           ORDER BY day DESC`,
          [days]
        )
      ]);

      const totals = totalsResult.rows[0];
      const pricingConfigured =
        numberFromEnv("OPENAI_INPUT_USD_PER_MILLION") !== null &&
        numberFromEnv("OPENAI_OUTPUT_USD_PER_MILLION") !== null;

      return res.json({
        days,
        pricingConfigured,
        totals: {
          requests: Number(totals.requests),
          inputTokens: Number(totals.input_tokens),
          outputTokens: Number(totals.output_tokens),
          totalTokens: Number(totals.total_tokens),
          webSearchCalls: Number(totals.web_search_calls),
          pricedEvents: Number(totals.priced_events),
          estimatedCostMicros: Number(totals.estimated_cost_micros)
        },
        models: modelResult.rows.map((row) => ({
          provider: row.provider,
          model: row.model,
          requests: Number(row.requests),
          totalTokens: Number(row.total_tokens),
          webSearchCalls: Number(row.web_search_calls),
          pricedEvents: Number(row.priced_events),
          estimatedCostMicros: Number(row.estimated_cost_micros)
        })),
        daily: dailyResult.rows.map((row) => ({
          day: row.day,
          requests: Number(row.requests),
          totalTokens: Number(row.total_tokens),
          webSearchCalls: Number(row.web_search_calls),
          pricedEvents: Number(row.priced_events),
          estimatedCostMicros: Number(row.estimated_cost_micros)
        }))
      });
    } catch (error) {
      console.error("UNBOUND AI USAGE SUMMARY ERROR:", error);
      return res.status(500).json({
        error: "Could not load usage and cost totals."
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

        let removedComplimentarySlot = null;

        if (planTier !== "top") {
          const removedGrant = await client.query(
            `DELETE FROM complimentary_top_tier_grants
             WHERE user_id = $1
             RETURNING slot`,
            [userId]
          );

          if (removedGrant.rows[0]) {
            removedComplimentarySlot = Number(removedGrant.rows[0].slot);
          }
        }

        const updateResult = await client.query(
          `UPDATE users
           SET plan_tier = $1,
               updated_at = NOW()
           WHERE id = $2
           RETURNING id, email, display_name, role, plan_tier, created_at`,
          [planTier, userId]
        );

        await writeAdminAudit(
          client,
          req.adminUser,
          "user.plan.changed",
          target,
          {
            previousPlanTier: target.plan_tier,
            newPlanTier: planTier,
            removedComplimentarySlot
          }
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

        await writeAdminAudit(
          client,
          req.adminUser,
          "complimentary_top_tier.granted",
          user,
          {
            slot,
            previousPlanTier: user.plan_tier,
            newPlanTier: "top"
          }
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

        await writeAdminAudit(
          client,
          req.adminUser,
          "complimentary_top_tier.revoked",
          target,
          {
            slot: Number(deleted.rows[0].slot),
            resultingPlanTier: target.role === "admin" ? "top" : "free"
          }
        );

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

function normalizeDepthStyle(value) {
  return String(value || "").trim().toLowerCase() === "work"
    ? "work"
    : "casual";
}

function normalizeProductMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "research") return "research";
  if (normalized === "creative") return "creative";
  if (normalized === "unbound") return "unbound";
  if (normalized === "adult") return "adult";
  return "standard";
}

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
    .slice(-50);
}

app.post("/api/chat", chatRateLimit, researchRateLimit, async (req, res) => {
  try {
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!message) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    const gatewayStatus = getGatewayStatus();

    if (!gatewayStatus.configured) {
      return res.status(503).json({
        error:
          gatewayStatus.error === "unsupported-provider"
            ? "AI provider '" + gatewayStatus.provider + "' is not supported."
            : "AI provider '" + gatewayStatus.provider + "' is not configured."
      });
    }

    const depthStyle = normalizeDepthStyle(req.body.depthStyle);
    const productMode = normalizeProductMode(req.body.productMode);

    await assertOptionalAccountCapability(req, "chat");
    await assertOptionalAccountCapability(
      req,
      depthStyle === "work" ? "work_mode" : "casual_mode"
    );

    if (productMode === "research" && !gatewayStatus.research) {
      return res.status(503).json({
        error: "The active AI provider does not support Research Mode yet."
      });
    }

    if (productMode === "research") {
      await assertRequestCapability(req, "web_research");
      await assertRequestCapability(req, "citations");
    }
    if (productMode === "creative") {
      await assertOptionalAccountCapability(req, "creative_mode");
    }
    if (productMode === "unbound") {
      await assertOptionalAccountCapability(req, "unbound_mode");
    }
    if (productMode === "adult") {
      await assertAgeVerifiedAdult(req);
      await assertRequestCapability(req, "adult_mode");
    }

    const persistentChat = await preparePersistentChat(
      req,
      message,
      depthStyle,
      productMode
    );
    const aiStyle = await resolveAiStyleForRequest(req, persistentChat?.user || null);
    const styleInstructions = getAiStylePrompt(aiStyle);
    const history = persistentChat
      ? persistentChat.history
      : cleanHistory(req.body.history).slice(-20);
    const depthInstructions =
      depthStyle === "work" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;
    const modeInstructions =
      productMode === "research"
        ? RESEARCH_MODE_PROMPT
        : productMode === "creative"
          ? CREATIVE_MODE_PROMPT
          : productMode === "unbound"
            ? UNBOUND_MODE_PROMPT
            : productMode === "adult"
              ? ADULT_MODE_PROMPT
              : "";

    const input = [
      ...history,
      {
        role: "user",
        content: message.slice(0, 12000)
      }
    ];

    const aiResponse = await generateChat({
      model: gatewayStatus.model,
      instructions: [UNBOUND_SYSTEM_PROMPT, styleInstructions, depthInstructions, modeInstructions]
        .filter(Boolean)
        .join("\n\n"),
      input,
      research:
        productMode === "research"
          ? { enabled: true, maxToolCalls: depthStyle === "work" ? 8 : 4 }
          : null
    });

    const researchMetadata = aiResponse.research || {
      sources: [],
      citations: [],
      webSearchCalls: 0
    };

    if (persistentChat) {
      await persistAssistantMessage(
        persistentChat,
        aiResponse.reply,
        depthStyle,
        productMode,
        researchMetadata
      );
    }

    if (
      databaseReady &&
      pool &&
      (aiResponse.usage || researchMetadata.webSearchCalls)
    ) {
      try {
        const sessionUser = persistentChat?.user || await findSessionUser(req);

        await recordUsageEvent({
          userId: sessionUser?.id || null,
          provider: aiResponse.provider,
          model: aiResponse.model,
          eventType: "chat_" + productMode + "_" + depthStyle,
          usage: aiResponse.usage,
          webSearchCalls: researchMetadata.webSearchCalls,
          estimatedCostMicros: estimateProviderCostMicros(
            aiResponse.provider,
            aiResponse.usage
          ),
          providerResponseId: aiResponse.responseId
        });
      } catch (usageError) {
        console.error("UNBOUND AI USAGE METER ERROR:", usageError);
      }
    }

    res.json({
      reply: aiResponse.reply,
      depthStyle,
      productMode,
      aiStyle,
      provider: aiResponse.provider,
      model: aiResponse.model,
      sources: researchMetadata.sources,
      citations: researchMetadata.citations,
      webSearchCalls: researchMetadata.webSearchCalls,
      conversationId: persistentChat?.conversationId || null
    });
  } catch (error) {
    console.error("UNBOUND AI ERROR:", error);

    res.status(error.statusCode || 500).json({
      error: error.message || "UNBOUND AI could not get a response."
    });
  }
});

app.post("/api/chat/stream", chatRateLimit, async (req, res) => {
  try {
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!message) {
      return res.status(400).json({ error: "Please enter a message." });
    }

    const gatewayStatus = getGatewayStatus();

    if (!gatewayStatus.configured) {
      return res.status(503).json({
        error:
          gatewayStatus.error === "unsupported-provider"
            ? "AI provider '" + gatewayStatus.provider + "' is not supported."
            : "AI provider '" + gatewayStatus.provider + "' is not configured."
      });
    }

    const depthStyle = normalizeDepthStyle(req.body.depthStyle);
    const productMode = normalizeProductMode(req.body.productMode);

    if (productMode === "research") {
      return res.status(400).json({
        error: "Research Mode uses the sourced response endpoint instead of streaming."
      });
    }

    await assertOptionalAccountCapability(req, "chat");
    await assertOptionalAccountCapability(
      req,
      depthStyle === "work" ? "work_mode" : "casual_mode"
    );
    await assertOptionalAccountCapability(req, "streaming");
    if (productMode === "creative") {
      await assertOptionalAccountCapability(req, "creative_mode");
    }
    if (productMode === "unbound") {
      await assertOptionalAccountCapability(req, "unbound_mode");
    }
    if (productMode === "adult") {
      await assertAgeVerifiedAdult(req);
      await assertRequestCapability(req, "adult_mode");
    }

    const persistentChat = await preparePersistentChat(
      req,
      message,
      depthStyle,
      productMode
    );
    const aiStyle = await resolveAiStyleForRequest(req, persistentChat?.user || null);
    const styleInstructions = getAiStylePrompt(aiStyle);
    const history = persistentChat
      ? persistentChat.history
      : cleanHistory(req.body.history).slice(-20);
    const depthInstructions =
      depthStyle === "work" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;
    const modeInstructions =
      productMode === "creative"
        ? CREATIVE_MODE_PROMPT
        : productMode === "unbound"
          ? UNBOUND_MODE_PROMPT
          : productMode === "adult"
            ? ADULT_MODE_PROMPT
            : "";
    const input = [
      ...history,
      { role: "user", content: message.slice(0, 12000) }
    ];

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const writeEvent = (event) => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(JSON.stringify(event) + "\n");
      }
    };

    writeEvent({
      type: "meta",
      depthStyle,
      productMode,
      aiStyle,
      provider: gatewayStatus.provider,
      model: gatewayStatus.model,
      conversationId: persistentChat?.conversationId || null
    });

    const aiResponse = await streamChat({
      model: gatewayStatus.model,
      instructions: [UNBOUND_SYSTEM_PROMPT, styleInstructions, depthInstructions, modeInstructions]
        .filter(Boolean)
        .join("\n\n"),
      input,
      onDelta: async (delta) => {
        writeEvent({ type: "delta", delta });
      }
    });

    if (persistentChat) {
      await persistAssistantMessage(
        persistentChat,
        aiResponse.reply,
        depthStyle,
        productMode,
        { sources: [], citations: [], webSearchCalls: 0 }
      );
    }

    if (databaseReady && pool && aiResponse.usage) {
      try {
        const sessionUser = persistentChat?.user || await findSessionUser(req);
        await recordUsageEvent({
          userId: sessionUser?.id || null,
          provider: aiResponse.provider,
          model: aiResponse.model,
          eventType: "chat_stream_" + productMode + "_" + depthStyle,
          usage: aiResponse.usage,
          webSearchCalls: 0,
          estimatedCostMicros: estimateProviderCostMicros(
            aiResponse.provider,
            aiResponse.usage
          ),
          providerResponseId: aiResponse.responseId
        });
      } catch (usageError) {
        console.error("UNBOUND AI STREAM USAGE METER ERROR:", usageError);
      }
    }

    writeEvent({
      type: "done",
      depthStyle,
      productMode,
      aiStyle,
      provider: aiResponse.provider,
      model: aiResponse.model,
      conversationId: persistentChat?.conversationId || null
    });
    res.end();
  } catch (error) {
    console.error("UNBOUND AI STREAM ERROR:", error);

    if (res.headersSent) {
      if (!res.writableEnded && !res.destroyed) {
        res.write(
          JSON.stringify({
            type: "error",
            error: error.message || "UNBOUND AI could not get a response."
          }) + "\n"
        );
        res.end();
      }
      return;
    }

    res.status(error.statusCode || 500).json({
      error: error.message || "UNBOUND AI could not get a response."
    });
  }
});

app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "index.html"));
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`UNBOUND AI running on port ${PORT}`);
});

let shutdownTimer = null;

async function shutdownGracefully(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  databaseReady = false;

  if (databaseRetryTimer) {
    clearTimeout(databaseRetryTimer);
    databaseRetryTimer = null;
  }

  console.log(`UNBOUND AI received ${signal}; beginning graceful shutdown.`);

  shutdownTimer = setTimeout(() => {
    console.error("UNBOUND AI graceful shutdown timed out; forcing exit.");
    process.exit(1);
  }, 10000);
  shutdownTimer.unref?.();

  server.close(async (serverError) => {
    if (serverError) {
      console.error("UNBOUND AI HTTP SERVER CLOSE ERROR:", serverError);
    }

    const activePool = pool;
    pool = null;
    await closePoolQuietly(activePool);

    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }

    process.exit(serverError ? 1 : 0);
  });
}

process.once("SIGTERM", () => {
  void shutdownGracefully("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdownGracefully("SIGINT");
});
