const AGE_VERIFICATION_STATUSES = Object.freeze([
  "unverified",
  "pending",
  "verified",
  "failed",
  "expired",
  "revoked"
]);

const WEBHOOK_STATUSES = new Set([
  "pending",
  "verified",
  "failed",
  "expired",
  "revoked"
]);

const adapters = new Map();

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!provider) return "";
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider) ? provider : "";
}

function normalizeAgeVerificationStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return AGE_VERIFICATION_STATUSES.includes(normalized)
    ? normalized
    : "unverified";
}

function ageVerificationAllowsAdultAccess(status, expiresAt = null) {
  if (normalizeAgeVerificationStatus(status) !== "verified") return false;
  if (!expiresAt) return true;

  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > Date.now();
}

function resolveAgeVerificationTransition(currentStatus, incomingStatus) {
  const current = normalizeAgeVerificationStatus(currentStatus);
  const incoming = normalizeAgeVerificationStatus(incomingStatus);
  if (!WEBHOOK_STATUSES.has(incoming)) {
    return { apply: false, status: current, reason: "invalid-incoming-status" };
  }
  if (current === "verified" && ["pending", "failed"].includes(incoming)) {
    return { apply: false, status: current, reason: "preserve-active-verification" };
  }
  return { apply: true, status: incoming, reason: null };
}

function registerAgeVerificationAdapter(name, adapter) {
  const provider = normalizeProvider(name);
  if (!provider) throw new Error("Age-verification adapter name is invalid.");
  if (!adapter || typeof adapter !== "object") {
    throw new Error("Age-verification adapter must be an object.");
  }
  adapters.set(provider, adapter);
}

function getAgeVerificationAdapter(name) {
  const provider = normalizeProvider(name);
  return provider ? adapters.get(provider) || null : null;
}

function adapterConfigured(adapter, env) {
  return typeof adapter?.isConfigured === "function"
    ? Boolean(adapter.isConfigured(env))
    : true;
}

function getAgeVerificationGatewayStatus(env = process.env) {
  const provider = normalizeProvider(env.AGE_VERIFICATION_PROVIDER);

  if (!provider) {
    return {
      provider: null,
      configured: false,
      adapterInstalled: false,
      state: "provider-not-selected",
      minimumAge: 18,
      storesRawIdentityEvidence: false,
      storesBiometricTemplates: false,
      startVerification: false,
      webhooks: false
    };
  }

  const adapter = getAgeVerificationAdapter(provider);
  if (!adapter) {
    return {
      provider,
      configured: false,
      adapterInstalled: false,
      state: "adapter-not-installed",
      minimumAge: 18,
      storesRawIdentityEvidence: false,
      storesBiometricTemplates: false,
      startVerification: false,
      webhooks: false
    };
  }

  const capabilities = adapter.capabilities || {};
  const configured = adapterConfigured(adapter, env);

  return {
    provider,
    configured,
    adapterInstalled: true,
    state: configured ? "ready" : "adapter-not-configured",
    minimumAge: 18,
    storesRawIdentityEvidence: false,
    storesBiometricTemplates: false,
    startVerification:
      configured &&
      Boolean(capabilities.startVerification) &&
      typeof adapter.startVerification === "function",
    webhooks:
      configured &&
      Boolean(capabilities.webhooks) &&
      typeof adapter.verifyWebhook === "function" &&
      typeof adapter.parseWebhook === "function"
  };
}

function ageGatewayError(code, publicMessage, statusCode = 503) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  error.statusCode = statusCode;
  return error;
}

function cleanOpaqueSubject(value) {
  const subject = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(subject)) return null;
  return subject;
}

function cleanHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function cleanProviderReference(value) {
  const reference = String(value || "").trim();
  if (!reference || reference.length > 500) return null;
  return reference;
}

function cleanIdentifier(value, maxLength = 200) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function cleanFutureTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) return null;
  return parsed.toISOString();
}

function cleanTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

async function startAgeVerificationSession({
  subject,
  returnUrl = null,
  cancelUrl = null,
  requestId = null,
  env = process.env
} = {}) {
  const gateway = getAgeVerificationGatewayStatus(env);
  if (!gateway.provider) {
    throw ageGatewayError(
      "AGE_VERIFICATION_PROVIDER_NOT_SELECTED",
      "Hard age verification is not available yet because no verification provider is selected."
    );
  }

  const adapter = getAgeVerificationAdapter(gateway.provider);
  if (!adapter) {
    throw ageGatewayError(
      "AGE_VERIFICATION_ADAPTER_NOT_INSTALLED",
      "Hard age verification is not available yet because the selected provider adapter is not installed."
    );
  }

  if (!gateway.configured) {
    throw ageGatewayError(
      "AGE_VERIFICATION_ADAPTER_NOT_CONFIGURED",
      "Hard age verification is temporarily unavailable because the provider is not fully configured."
    );
  }

  if (!gateway.startVerification) {
    throw ageGatewayError(
      "AGE_VERIFICATION_START_UNAVAILABLE",
      "The selected age-verification provider cannot start a verification session."
    );
  }

  const opaqueSubject = cleanOpaqueSubject(subject);
  if (!opaqueSubject) {
    throw ageGatewayError(
      "AGE_VERIFICATION_SUBJECT_INVALID",
      "Could not create a privacy-safe age-verification subject.",
      500
    );
  }

  const result = await adapter.startVerification({
    subject: opaqueSubject,
    minimumAge: 18,
    returnUrl: returnUrl ? cleanHttpsUrl(returnUrl) : null,
    cancelUrl: cancelUrl ? cleanHttpsUrl(cancelUrl) : null,
    requestId: String(requestId || "").trim().slice(0, 128) || null,
    env
  });

  const verificationUrl = cleanHttpsUrl(result?.verificationUrl);
  const providerReference = cleanProviderReference(result?.reference);
  if (!verificationUrl || !providerReference) {
    throw ageGatewayError(
      "AGE_VERIFICATION_PROVIDER_RESPONSE_INVALID",
      "The age-verification provider returned an invalid session response.",
      502
    );
  }

  return {
    provider: gateway.provider,
    status: "pending",
    minimumAge: 18,
    verificationUrl,
    providerReference,
    expiresAt: cleanFutureTimestamp(result?.expiresAt)
  };
}

async function processAgeVerificationWebhook({
  rawBody,
  headers = {},
  requestId = null,
  env = process.env
} = {}) {
  const gateway = getAgeVerificationGatewayStatus(env);
  if (!gateway.provider || !gateway.configured || !gateway.webhooks) {
    throw ageGatewayError(
      "AGE_VERIFICATION_WEBHOOK_UNAVAILABLE",
      "Age-verification webhooks are not configured.",
      503
    );
  }

  const adapter = getAgeVerificationAdapter(gateway.provider);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  const verified = await adapter.verifyWebhook({
    rawBody: body,
    headers,
    requestId: String(requestId || "").trim().slice(0, 128) || null,
    env
  });
  if (verified !== true) {
    throw ageGatewayError(
      "AGE_VERIFICATION_WEBHOOK_SIGNATURE_INVALID",
      "Age-verification webhook signature is invalid.",
      401
    );
  }

  const parsed = await adapter.parseWebhook({
    rawBody: body,
    headers,
    env
  });
  const eventId = cleanIdentifier(parsed?.eventId);
  const providerReference = cleanProviderReference(parsed?.reference);
  const status = normalizeAgeVerificationStatus(parsed?.status);
  const occurredAt = cleanTimestamp(parsed?.occurredAt);
  const eventType = cleanIdentifier(parsed?.eventType, 120) || status;
  const resultCode = cleanIdentifier(parsed?.resultCode, 120);
  const verifiedAt = cleanTimestamp(parsed?.verifiedAt);
  const expiresAt = parsed?.expiresAt ? cleanTimestamp(parsed.expiresAt) : null;

  if (!eventId || !providerReference || !WEBHOOK_STATUSES.has(status) || !occurredAt) {
    throw ageGatewayError(
      "AGE_VERIFICATION_WEBHOOK_PAYLOAD_INVALID",
      "Age-verification webhook payload is invalid.",
      400
    );
  }
  if (status === "verified" && parsed?.meetsMinimumAge !== true) {
    throw ageGatewayError(
      "AGE_VERIFICATION_WEBHOOK_AGE_NOT_CONFIRMED",
      "Age-verification webhook did not confirm the required age threshold.",
      400
    );
  }

  return {
    provider: gateway.provider,
    providerEventId: eventId,
    providerReference,
    eventType,
    status,
    resultCode,
    occurredAt,
    verifiedAt: status === "verified" ? (verifiedAt || occurredAt) : null,
    expiresAt,
    minimumAge: 18
  };
}

module.exports = {
  AGE_VERIFICATION_STATUSES,
  normalizeProvider,
  normalizeAgeVerificationStatus,
  ageVerificationAllowsAdultAccess,
  resolveAgeVerificationTransition,
  registerAgeVerificationAdapter,
  getAgeVerificationAdapter,
  getAgeVerificationGatewayStatus,
  startAgeVerificationSession,
  processAgeVerificationWebhook
};
