const adapters = new Map();
const PAYMENT_STATUSES = Object.freeze(["pending", "paid", "failed", "canceled", "refunded"]);

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!provider) return "";
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider) ? provider : "";
}

function registerAdvertisingPaymentAdapter(name, adapter) {
  const provider = normalizeProvider(name);
  if (!provider) throw new Error("Advertising payment adapter name is invalid.");
  if (!adapter || typeof adapter !== "object") {
    throw new Error("Advertising payment adapter must be an object.");
  }
  adapters.set(provider, adapter);
}

function getAdvertisingPaymentAdapter(name) {
  const provider = normalizeProvider(name);
  return provider ? adapters.get(provider) || null : null;
}

function getAdvertisingPaymentStatus(env = process.env) {
  const provider = normalizeProvider(env.ADVERTISING_PAYMENT_PROVIDER || env.BILLING_PROVIDER);
  if (!provider) {
    return {
      configured: false,
      provider: null,
      adapterInstalled: false,
      checkout: false,
      webhooks: false,
      state: "provider-not-selected"
    };
  }

  const adapter = getAdvertisingPaymentAdapter(provider);
  if (!adapter) {
    return {
      configured: false,
      provider,
      adapterInstalled: false,
      checkout: false,
      webhooks: false,
      state: "adapter-not-installed"
    };
  }

  const configured = typeof adapter.isConfigured === "function"
    ? Boolean(adapter.isConfigured(env))
    : true;
  const capabilities = adapter.capabilities || {};

  return {
    configured,
    provider,
    adapterInstalled: true,
    checkout:
      configured && Boolean(capabilities.checkout) && typeof adapter.startCheckout === "function",
    webhooks:
      configured &&
      Boolean(capabilities.webhooks) &&
      typeof adapter.verifyWebhook === "function" &&
      typeof adapter.parseWebhook === "function",
    state: configured ? "ready" : "adapter-not-configured"
  };
}

function gatewayError(code, publicMessage, statusCode = 503) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  error.statusCode = statusCode;
  return error;
}

function cleanOpaque(value, maxLength = 300) {
  const text = String(value || "").trim();
  return text && text.length <= maxLength ? text : null;
}

function cleanHttpsUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value).trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch (_) {
    return null;
  }
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function normalizePaymentStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return PAYMENT_STATUSES.includes(status) ? status : null;
}

function cleanTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function startAdvertisingCheckout({
  subject,
  email,
  packageCode,
  amountCents,
  currency,
  successUrl,
  cancelUrl,
  requestId = null,
  env = process.env
} = {}) {
  const gateway = getAdvertisingPaymentStatus(env);
  if (!gateway.provider || !gateway.configured || !gateway.checkout) {
    throw gatewayError(
      "ADVERTISING_CHECKOUT_UNAVAILABLE",
      "Advertising checkout is not configured yet.",
      503
    );
  }

  const normalizedSubject = cleanOpaque(subject, 200);
  const normalizedEmail = cleanEmail(email);
  const normalizedPackage = cleanOpaque(packageCode, 60);
  const normalizedAmount = Number.parseInt(String(amountCents || ""), 10);
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (
    !normalizedSubject ||
    !normalizedEmail ||
    !normalizedPackage ||
    !Number.isFinite(normalizedAmount) ||
    normalizedAmount <= 0 ||
    !/^[A-Z]{3}$/.test(normalizedCurrency)
  ) {
    throw gatewayError("ADVERTISING_CHECKOUT_INPUT_INVALID", "Advertising checkout request is invalid.", 400);
  }

  const adapter = getAdvertisingPaymentAdapter(gateway.provider);
  const result = await adapter.startCheckout({
    subject: normalizedSubject,
    email: normalizedEmail,
    productType: "advertising",
    productCode: normalizedPackage,
    amountCents: normalizedAmount,
    currency: normalizedCurrency,
    successUrl: cleanHttpsUrl(successUrl),
    cancelUrl: cleanHttpsUrl(cancelUrl),
    requestId: cleanOpaque(requestId, 128),
    env
  });

  const checkoutUrl = cleanHttpsUrl(result?.checkoutUrl || result?.url);
  if (!checkoutUrl) {
    throw gatewayError(
      "ADVERTISING_PROVIDER_RESPONSE_INVALID",
      "The payment provider returned an invalid secure checkout URL.",
      502
    );
  }

  return {
    provider: gateway.provider,
    checkoutUrl,
    expiresAt: cleanTimestamp(result?.expiresAt)
  };
}

async function processAdvertisingWebhook({
  rawBody,
  headers = {},
  requestId = null,
  env = process.env
} = {}) {
  const gateway = getAdvertisingPaymentStatus(env);
  if (!gateway.provider || !gateway.configured || !gateway.webhooks) {
    throw gatewayError(
      "ADVERTISING_WEBHOOK_UNAVAILABLE",
      "Advertising payment webhooks are not configured.",
      503
    );
  }
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw gatewayError("ADVERTISING_WEBHOOK_BODY_INVALID", "Advertising webhook body is invalid.", 400);
  }

  const adapter = getAdvertisingPaymentAdapter(gateway.provider);
  const verified = await adapter.verifyWebhook({ rawBody, headers, requestId, env });
  if (!verified) {
    throw gatewayError(
      "ADVERTISING_WEBHOOK_SIGNATURE_INVALID",
      "Advertising webhook signature is invalid.",
      401
    );
  }

  const parsed = await adapter.parseWebhook({ rawBody, headers, requestId, env });
  const providerEventId = cleanOpaque(parsed?.eventId || parsed?.providerEventId, 300);
  const subject = cleanOpaque(parsed?.subject, 200);
  const eventType = cleanOpaque(parsed?.eventType || "payment.updated", 200);
  const paymentStatus = normalizePaymentStatus(parsed?.status || parsed?.paymentStatus);
  const occurredAt = cleanTimestamp(parsed?.occurredAt || parsed?.createdAt);

  if (!providerEventId || !subject || !eventType || !paymentStatus || !occurredAt) {
    throw gatewayError(
      "ADVERTISING_WEBHOOK_PAYLOAD_INVALID",
      "Advertising webhook payload is invalid.",
      400
    );
  }

  return {
    provider: gateway.provider,
    providerEventId,
    eventType,
    subject,
    paymentStatus,
    occurredAt
  };
}

module.exports = {
  PAYMENT_STATUSES,
  registerAdvertisingPaymentAdapter,
  getAdvertisingPaymentAdapter,
  getAdvertisingPaymentStatus,
  startAdvertisingCheckout,
  processAdvertisingWebhook
};
