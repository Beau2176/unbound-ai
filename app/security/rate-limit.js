const crypto = require("crypto");

function positiveIntEnv(env, name, fallback, { min = 1, max = 100000 } = {}) {
  const value = Number.parseInt(String(env?.[name] ?? ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function getRateLimitPolicy(env = process.env) {
  return Object.freeze({
    login: Object.freeze({ scope: "auth_login", limit: positiveIntEnv(env, "RATE_LIMIT_LOGIN_PER_15_MIN", 12, { max: 1000 }), windowSeconds: 15 * 60 }),
    register: Object.freeze({ scope: "auth_register", limit: positiveIntEnv(env, "RATE_LIMIT_REGISTER_PER_HOUR", 6, { max: 1000 }), windowSeconds: 60 * 60 }),
    passkeyAuth: Object.freeze({ scope: "auth_passkey", limit: positiveIntEnv(env, "RATE_LIMIT_PASSKEY_AUTH_PER_15_MIN", 40, { max: 2000 }), windowSeconds: 15 * 60 }),
    recovery: Object.freeze({ scope: "auth_recovery", limit: positiveIntEnv(env, "RATE_LIMIT_RECOVERY_PER_HOUR", 8, { max: 500 }), windowSeconds: 60 * 60 }),
    emailVerificationSend: Object.freeze({ scope: "email_verification_send", limit: positiveIntEnv(env, "RATE_LIMIT_EMAIL_VERIFICATION_SEND_PER_HOUR", 6, { max: 500 }), windowSeconds: 60 * 60 }),
    emailVerificationConsume: Object.freeze({ scope: "email_verification_consume", limit: positiveIntEnv(env, "RATE_LIMIT_EMAIL_VERIFICATION_CONSUME_PER_15_MIN", 40, { max: 2000 }), windowSeconds: 15 * 60 }),
    guestChat: Object.freeze({ scope: "chat_guest", limit: positiveIntEnv(env, "RATE_LIMIT_GUEST_CHAT_PER_HOUR", 60, { max: 10000 }), windowSeconds: 60 * 60 }),
    accountChat: Object.freeze({ scope: "chat_account", limit: positiveIntEnv(env, "RATE_LIMIT_ACCOUNT_CHAT_PER_HOUR", 300, { max: 10000 }), windowSeconds: 60 * 60 }),
    research: Object.freeze({ scope: "research_account", limit: positiveIntEnv(env, "RATE_LIMIT_RESEARCH_PER_HOUR", 60, { max: 10000 }), windowSeconds: 60 * 60 }),
    fileAnalysis: Object.freeze({ scope: "file_analysis_account", limit: positiveIntEnv(env, "RATE_LIMIT_FILE_ANALYSIS_PER_HOUR", 30, { max: 1000 }), windowSeconds: 60 * 60 }),
    imageUnderstanding: Object.freeze({ scope: "image_understanding_account", limit: positiveIntEnv(env, "RATE_LIMIT_IMAGE_UNDERSTANDING_PER_HOUR", 30, { max: 1000 }), windowSeconds: 60 * 60 }),
    imageTools: Object.freeze({ scope: "image_tools_account", limit: positiveIntEnv(env, "RATE_LIMIT_IMAGE_TOOLS_PER_HOUR", 20, { max: 500 }), windowSeconds: 60 * 60 }),
    voiceSessions: Object.freeze({ scope: "voice_account", limit: positiveIntEnv(env, "RATE_LIMIT_VOICE_SPEECH_PER_HOUR", 120, { max: 5000 }), windowSeconds: 60 * 60 }),
    agentRuns: Object.freeze({ scope: "agent_run_account", limit: positiveIntEnv(env, "RATE_LIMIT_AGENT_RUNS_PER_HOUR", 10, { max: 500 }), windowSeconds: 60 * 60 }),
    securityActions: Object.freeze({ scope: "security_action", limit: positiveIntEnv(env, "RATE_LIMIT_SECURITY_ACTIONS_PER_HOUR", 30, { max: 1000 }), windowSeconds: 60 * 60 })
  });
}

function hashRateLimitSubject(secret, value) {
  return crypto.createHmac("sha256", String(secret || "unbound-rate-limit-development-key")).update(String(value || "")).digest("hex");
}

function getRateLimitStatus(env = process.env) {
  const policy = getRateLimitPolicy(env);
  return { configured: true, storage: "postgresql", rawIpStored: false, guestIdentity: "random-http-only-browser-token", policy };
}

module.exports = { positiveIntEnv, getRateLimitPolicy, hashRateLimitSubject, getRateLimitStatus };
