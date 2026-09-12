const BILLING_STATUSES = Object.freeze([
  "none",
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "paused",
  "canceled",
  "unpaid"
]);

const adapters = new Map();

function normalizeBillingProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!provider) return "";
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider) ? provider : "";
}

function normalizeSubscriptionStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return BILLING_STATUSES.includes(status) ? status : "none";
}

function subscriptionStatusAllowsAccess(status) {
  return ["active", "trialing"].includes(normalizeSubscriptionStatus(status));
}

function registerBillingAdapter(name, adapter) {
  const provider = normalizeBillingProvider(name);
  if (!provider) throw new Error("Billing adapter name is invalid.");
  if (!adapter || typeof adapter !== "object") {
    throw new Error("Billing adapter must be an object.");
  }
  adapters.set(provider, adapter);
}

function getBillingAdapter(name) {
  const provider = normalizeBillingProvider(name);
  return provider ? adapters.get(provider) || null : null;
}

function getBillingGatewayStatus(env = process.env) {
  const provider = normalizeBillingProvider(env.BILLING_PROVIDER);
  if (!provider) {
    return {
      configured: false,
      provider: null,
      adapterInstalled: false,
      checkout: false,
      customerPortal: false,
      webhooks: false,
      state: "provider-not-selected"
    };
  }

  const adapter = getBillingAdapter(provider);
  if (!adapter) {
    return {
      configured: false,
      provider,
      adapterInstalled: false,
      checkout: false,
      customerPortal: false,
      webhooks: false,
      state: "adapter-not-installed"
    };
  }

  const capabilities = adapter.capabilities || {};
  const configured =
    typeof adapter.isConfigured === "function"
      ? Boolean(adapter.isConfigured(env))
      : true;

  return {
    configured,
    provider,
    adapterInstalled: true,
    checkout: configured && Boolean(capabilities.checkout) && typeof adapter.startCheckout === "function",
    customerPortal:
      configured &&
      Boolean(capabilities.customerPortal) &&
      typeof adapter.startCustomerPortal === "function",
    webhooks: configured && Boolean(capabilities.webhooks),
    state: configured ? "ready" : "adapter-not-configured"
  };
}

function billingGatewayError(code, publicMessage, statusCode = 503) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  error.statusCode = statusCode;
  return error;
}

function cleanOpaqueIdentifier(value, maxLength = 300) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
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

function cleanFutureTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) return null;
  return parsed.toISOString();
}

async function startBillingCheckoutSession({
  subject,
  email,
  planTier = "top",
  successUrl = null,
  cancelUrl = null,
  requestId = null,
  env = process.env
} = {}) {
  const gateway = getBillingGatewayStatus(env);
  if (!gateway.provider || !gateway.configured || !gateway.checkout) {
    throw billingGatewayError(
      "BILLING_CHECKOUT_UNAVAILABLE",
      "Subscription checkout is not configured.",
      503
    );
  }

  const normalizedSubject = cleanOpaqueIdentifier(subject, 200);
  const normalizedEmail = cleanEmail(email);
  const normalizedPlan = String(planTier || "").trim().toLowerCase();
  if (!normalizedSubject || !normalizedEmail || normalizedPlan !== "top") {
    throw billingGatewayError(
      "BILLING_CHECKOUT_INPUT_INVALID",
      "Subscription checkout request is invalid.",
      400
    );
  }

  const adapter = getBillingAdapter(gateway.provider);
  const result = await adapter.startCheckout({
    subject: normalizedSubject,
    email: normalizedEmail,
    planTier: normalizedPlan,
    successUrl: cleanHttpsUrl(successUrl),
    cancelUrl: cleanHttpsUrl(cancelUrl),
    requestId: cleanOpaqueIdentifier(requestId, 128),
    env
  });

  const checkoutUrl = cleanHttpsUrl(result?.checkoutUrl || result?.url);
  if (!checkoutUrl) {
    throw billingGatewayError(
      "BILLING_PROVIDER_RESPONSE_INVALID",
      "The billing provider returned an invalid secure checkout URL.",
      502
    );
  }

  return {
    provider: gateway.provider,
    checkoutUrl,
    expiresAt: cleanFutureTimestamp(result?.expiresAt)
  };
}

async function startBillingCustomerPortalSession({
  subject,
  email,
  providerCustomerId,
  returnUrl = null,
  requestId = null,
  env = process.env
} = {}) {
  const gateway = getBillingGatewayStatus(env);
  if (!gateway.provider || !gateway.configured || !gateway.customerPortal) {
    throw billingGatewayError(
      "BILLING_PORTAL_UNAVAILABLE",
      "Subscription management is not configured.",
      503
    );
  }

  const normalizedSubject = cleanOpaqueIdentifier(subject, 200);
  const normalizedEmail = cleanEmail(email);
  const normalizedCustomerId = cleanOpaqueIdentifier(providerCustomerId, 300);
  if (!normalizedSubject || !normalizedEmail || !normalizedCustomerId) {
    throw billingGatewayError(
      "BILLING_PORTAL_INPUT_INVALID",
      "Subscription management request is invalid.",
      400
    );
  }

  const adapter = getBillingAdapter(gateway.provider);
  const result = await adapter.startCustomerPortal({
    subject: normalizedSubject,
    email: normalizedEmail,
    providerCustomerId: normalizedCustomerId,
    returnUrl: cleanHttpsUrl(returnUrl),
    requestId: cleanOpaqueIdentifier(requestId, 128),
    env
  });

  const portalUrl = cleanHttpsUrl(result?.portalUrl || result?.url);
  if (!portalUrl) {
    throw billingGatewayError(
      "BILLING_PROVIDER_RESPONSE_INVALID",
      "The billing provider returned an invalid secure account-management URL.",
      502
    );
  }

  return {
    provider: gateway.provider,
    portalUrl,
    expiresAt: cleanFutureTimestamp(result?.expiresAt)
  };
}

module.exports = {
  BILLING_STATUSES,
  normalizeBillingProvider,
  normalizeSubscriptionStatus,
  subscriptionStatusAllowsAccess,
  registerBillingAdapter,
  getBillingAdapter,
  getBillingGatewayStatus,
  startBillingCheckoutSession,
  startBillingCustomerPortalSession
};
