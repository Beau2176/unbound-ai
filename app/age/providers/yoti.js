const crypto = require("crypto");

const PROVIDER_ID = "yoti";
const YOTI_SESSIONS_URL = "https://age.yoti.com/api/v1/sessions";
const YOTI_USER_VIEW_URL = "https://age.yoti.com/";
const DEFAULT_TTL_SECONDS = 900;
const DEFAULT_VERIFICATION_VALID_DAYS = 365;

const capabilities = Object.freeze({
  startVerification: true,
  webhooks: true
});

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function safeText(value, maxLength = 1000) {
  const text = String(value || "").trim();
  return text && text.length <= maxLength ? text : null;
}

function positiveInteger(value, fallback, { min = 1, max = 3650 } = {}) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizePublicKey(value) {
  const text = String(value || "").trim().replace(/\\n/g, "\n");
  if (!text.includes("BEGIN PUBLIC KEY") || !text.includes("END PUBLIC KEY")) return null;
  try {
    const key = crypto.createPublicKey(text);
    if (!["rsa", "rsa-pss"].includes(key.asymmetricKeyType)) return null;
    return text;
  } catch {
    return null;
  }
}

function getYotiConfig(env = process.env) {
  const apiKey = safeText(env.YOTI_API_KEY, 2000);
  const sdkId = safeText(env.YOTI_SDK_ID, 120);
  const templateId = safeText(env.YOTI_TEMPLATE_ID, 200);
  const publicOrigin = normalizeHttpsUrl(env.PUBLIC_APP_ORIGIN);
  const notificationPublicKey = normalizePublicKey(env.YOTI_NOTIFICATION_PUBLIC_KEY);
  const ttlSeconds = positiveInteger(env.YOTI_SESSION_TTL_SECONDS, DEFAULT_TTL_SECONDS, {
    min: 60,
    max: 2_592_000
  });
  const verificationValidDays = positiveInteger(
    env.YOTI_VERIFICATION_VALID_DAYS,
    DEFAULT_VERIFICATION_VALID_DAYS,
    { min: 30, max: 3650 }
  );
  const adultIndustryOnboardingVerified = truthy(env.YOTI_ADULT_INDUSTRY_ONBOARDING_VERIFIED);
  const over18TemplateVerified = truthy(env.YOTI_OVER_18_TEMPLATE_VERIFIED);
  const notificationSignatureVerified = truthy(env.YOTI_NOTIFICATION_SIGNATURE_VERIFIED);

  return {
    apiKey,
    sdkId,
    templateId,
    publicOrigin,
    notificationPublicKey,
    ttlSeconds,
    verificationValidDays,
    adultIndustryOnboardingVerified,
    over18TemplateVerified,
    notificationSignatureVerified,
    configured: Boolean(
      apiKey &&
      sdkId &&
      templateId &&
      publicOrigin &&
      notificationPublicKey &&
      adultIndustryOnboardingVerified &&
      over18TemplateVerified &&
      notificationSignatureVerified
    )
  };
}

function yotiError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw yotiError("YOTI_RESPONSE_INVALID", "Yoti returned an invalid response.");
  }
}

async function startVerification({
  subject,
  minimumAge,
  returnUrl,
  cancelUrl,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = getYotiConfig(env);
  if (!config.configured) {
    throw yotiError("YOTI_NOT_CONFIGURED", "Yoti age verification is not fully configured.");
  }
  if (Number(minimumAge) !== 18) {
    throw yotiError("YOTI_MINIMUM_AGE_INVALID", "Yoti verification requires the approved over-18 threshold.");
  }
  const opaqueSubject = safeText(subject, 160);
  if (!opaqueSubject) {
    throw yotiError("YOTI_SUBJECT_INVALID", "Yoti age-verification subject is invalid.");
  }
  if (typeof fetchImpl !== "function") {
    throw yotiError("YOTI_FETCH_UNAVAILABLE", "Yoti age verification transport is unavailable.");
  }

  const callbackUrl = normalizeHttpsUrl(returnUrl) || config.publicOrigin;
  const cancel = normalizeHttpsUrl(cancelUrl) || config.publicOrigin;
  const notificationUrl = new URL("/api/webhooks/age-verification", config.publicOrigin).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  timeout.unref?.();

  let response;
  try {
    response = await fetchImpl(YOTI_SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Yoti-Sdk-Id": config.sdkId
      },
      body: JSON.stringify({
        template_id: config.templateId,
        ttl: config.ttlSeconds,
        reference_id: opaqueSubject,
        callback: {
          auto: true,
          url: callbackUrl
        },
        notification_url: notificationUrl,
        cancel_url: cancel,
        synchronous_checks: true
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw yotiError("YOTI_REQUEST_TIMEOUT", "Yoti age verification request timed out.");
    }
    throw yotiError("YOTI_REQUEST_FAILED", "Yoti age verification request failed.");
  } finally {
    clearTimeout(timeout);
  }

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw yotiError("YOTI_SESSION_CREATE_FAILED", "Yoti could not create an age-verification session.");
  }

  const sessionId = safeText(payload?.id || payload?.session_id, 200);
  if (!sessionId) {
    throw yotiError("YOTI_SESSION_RESPONSE_INVALID", "Yoti did not return a valid session reference.");
  }

  const verificationUrl = new URL(YOTI_USER_VIEW_URL);
  verificationUrl.searchParams.set("sessionId", sessionId);
  verificationUrl.searchParams.set("sdkId", config.sdkId);

  return {
    verificationUrl: verificationUrl.toString(),
    reference: sessionId,
    expiresAt: new Date(Date.now() + config.ttlSeconds * 1000).toISOString()
  };
}

function notificationPayloadForSignature(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { sequence_number: _sequenceNumber, signature: _signature, ...payload } = parsed;
  return JSON.stringify(payload).replace(/\s/g, "");
}

function verifyNotificationSignature({ rawBody, env = process.env } = {}) {
  const config = getYotiConfig(env);
  if (!config.notificationPublicKey || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return false;
  }

  const signatureText = safeText(parsed?.signature, 4000);
  const payload = notificationPayloadForSignature(parsed);
  if (!signatureText || !payload) return false;

  let signature;
  try {
    signature = Buffer.from(signatureText, "base64");
  } catch {
    return false;
  }
  const saltLength = signature.length - 32 - 2;
  if (!Number.isInteger(saltLength) || saltLength < 0) return false;

  try {
    return crypto.verify(
      "sha256",
      Buffer.from(payload, "utf8"),
      {
        key: config.notificationPublicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength
      },
      signature
    );
  } catch {
    return false;
  }
}

function normalizeNotificationStatus(parsed) {
  const state = String(parsed?.state || "").trim().toUpperCase();
  if (["EXPIRED", "TIMEOUT"].includes(state)) return "expired";
  if (["REVOKED"].includes(state)) return "revoked";
  if (["PENDING", "PROCESSING", "IN_PROGRESS"].includes(state)) return "pending";
  if (state === "COMPLETE") return parsed?.result === true ? "verified" : "failed";
  if (["FAIL", "FAILED", "ERROR"].includes(state)) return "failed";
  return parsed?.result === true ? "verified" : "failed";
}

function epochSecondsToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function addDays(timestamp, days) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getTime() + Number(days) * 86_400_000).toISOString();
}

async function verifyWebhook({ rawBody, env = process.env } = {}) {
  return verifyNotificationSignature({ rawBody, env });
}

async function parseWebhook({ rawBody, env = process.env } = {}) {
  const config = getYotiConfig(env);
  let parsed;
  try {
    parsed = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || ""));
  } catch {
    return {};
  }

  const providerReference = safeText(parsed?.session_key || parsed?.session_id, 500);
  const eventRoot = safeText(parsed?.id, 120) || providerReference;
  const sequence = Number.parseInt(String(parsed?.sequence_number || "0"), 10);
  const occurredAt = epochSecondsToIso(parsed?.timestamp) || new Date().toISOString();
  const status = normalizeNotificationStatus(parsed);
  const eventId = eventRoot
    ? `yoti:${eventRoot}:${Number.isInteger(sequence) && sequence >= 0 ? sequence : 0}`.slice(0, 200)
    : null;
  const method = safeText(parsed?.method, 60) || "unknown";
  const checkType = safeText(parsed?.check_type, 60) || "unknown";
  const resultCode = `yoti-${method}-${checkType}-${status}`.toLowerCase().slice(0, 120);

  return {
    eventId,
    reference: providerReference,
    eventType: `verification.${status}`,
    status,
    meetsMinimumAge: status === "verified" && parsed?.result === true,
    occurredAt,
    verifiedAt: status === "verified" ? occurredAt : null,
    expiresAt:
      status === "verified"
        ? addDays(occurredAt, config.verificationValidDays)
        : null,
    resultCode
  };
}

const yotiAgeVerificationAdapter = Object.freeze({
  id: PROVIDER_ID,
  capabilities,
  isConfigured(env = process.env) {
    return getYotiConfig(env).configured;
  },
  startVerification,
  verifyWebhook,
  parseWebhook
});

module.exports = {
  PROVIDER_ID,
  YOTI_SESSIONS_URL,
  YOTI_USER_VIEW_URL,
  DEFAULT_TTL_SECONDS,
  DEFAULT_VERIFICATION_VALID_DAYS,
  capabilities,
  truthy,
  positiveInteger,
  normalizeHttpsUrl,
  normalizePublicKey,
  getYotiConfig,
  notificationPayloadForSignature,
  verifyNotificationSignature,
  normalizeNotificationStatus,
  epochSecondsToIso,
  yotiAgeVerificationAdapter
};
