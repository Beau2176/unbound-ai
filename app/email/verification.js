const crypto = require("crypto");

const DEFAULT_TOKEN_TTL_MINUTES = 30;
const MIN_TOKEN_TTL_MINUTES = 10;
const MAX_TOKEN_TTL_MINUTES = 24 * 60;
const TOKEN_BYTES = 32;
const VERIFICATION_STATES = Object.freeze([
  "unverified",
  "pending",
  "verified",
  "expired",
  "failed"
]);

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getEmailVerificationConfig(env = process.env) {
  const ttlMinutes = boundedInteger(
    env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES,
    DEFAULT_TOKEN_TTL_MINUTES,
    MIN_TOKEN_TTL_MINUTES,
    MAX_TOKEN_TTL_MINUTES
  );

  return {
    tokenTtlMinutes: ttlMinutes,
    tokenTtlMs: ttlMinutes * 60 * 1000,
    secretConfigured: Boolean(String(env.EMAIL_VERIFICATION_TOKEN_SECRET || "").trim()),
    baseUrlConfigured: Boolean(String(env.PUBLIC_APP_ORIGIN || "").trim())
  };
}

function assertVerificationSecret(env = process.env) {
  const secret = String(env.EMAIL_VERIFICATION_TOKEN_SECRET || "").trim();
  if (!secret) {
    const error = new Error("Email verification token secret is not configured.");
    error.code = "EMAIL_VERIFICATION_SECRET_MISSING";
    throw error;
  }
  return secret;
}

function generateVerificationToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashVerificationToken(token, env = process.env) {
  const secret = assertVerificationSecret(env);
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    const error = new Error("Email verification token is required.");
    error.code = "EMAIL_VERIFICATION_TOKEN_REQUIRED";
    throw error;
  }

  return crypto
    .createHmac("sha256", secret)
    .update(normalizedToken, "utf8")
    .digest("hex");
}

function createVerificationChallenge({ now = new Date(), env = process.env } = {}) {
  const config = getEmailVerificationConfig(env);
  const token = generateVerificationToken();
  const createdAt = new Date(now);
  const expiresAt = new Date(createdAt.getTime() + config.tokenTtlMs);

  return {
    token,
    tokenHash: hashVerificationToken(token, env),
    createdAt,
    expiresAt
  };
}

function normalizeEmailVerificationState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VERIFICATION_STATES.includes(normalized) ? normalized : "unverified";
}

function isChallengeExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return true;
  const expires = new Date(expiresAt).getTime();
  const current = new Date(now).getTime();
  return !Number.isFinite(expires) || expires <= current;
}

function timingSafeHashEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyChallengeToken({ token, expectedHash, expiresAt, usedAt = null, now = new Date(), env = process.env }) {
  if (usedAt) {
    return { valid: false, reason: "already-used" };
  }
  if (isChallengeExpired(expiresAt, now)) {
    return { valid: false, reason: "expired" };
  }

  let presentedHash;
  try {
    presentedHash = hashVerificationToken(token, env);
  } catch (error) {
    if (error?.code === "EMAIL_VERIFICATION_TOKEN_REQUIRED") {
      return { valid: false, reason: "missing-token" };
    }
    throw error;
  }

  if (!timingSafeHashEqual(presentedHash, expectedHash)) {
    return { valid: false, reason: "invalid-token" };
  }

  return { valid: true, reason: "valid" };
}

function buildPublicEmailVerificationStatus(record = null, gatewayStatus = null, now = new Date()) {
  const rawState = normalizeEmailVerificationState(record?.status);
  const expiredPending = rawState === "pending" && isChallengeExpired(record?.expires_at || record?.expiresAt, now);
  const state = expiredPending ? "expired" : rawState;
  const verified = state === "verified";
  const gatewayConfigured = Boolean(gatewayStatus?.configured);
  const canSend = gatewayConfigured && !verified;

  return {
    state,
    verified,
    verificationRequired: !verified,
    canSend,
    canResend: canSend && ["unverified", "pending", "expired", "failed"].includes(state),
    expiresAt: state === "pending" ? record?.expires_at || record?.expiresAt || null : null
  };
}

module.exports = {
  DEFAULT_TOKEN_TTL_MINUTES,
  MIN_TOKEN_TTL_MINUTES,
  MAX_TOKEN_TTL_MINUTES,
  VERIFICATION_STATES,
  getEmailVerificationConfig,
  generateVerificationToken,
  hashVerificationToken,
  createVerificationChallenge,
  normalizeEmailVerificationState,
  isChallengeExpired,
  verifyChallengeToken,
  buildPublicEmailVerificationStatus
};
