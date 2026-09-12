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
    checkout: Boolean(capabilities.checkout),
    customerPortal: Boolean(capabilities.customerPortal),
    webhooks: Boolean(capabilities.webhooks),
    state: configured ? "ready" : "adapter-not-configured"
  };
}

module.exports = {
  BILLING_STATUSES,
  normalizeBillingProvider,
  normalizeSubscriptionStatus,
  subscriptionStatusAllowsAccess,
  registerBillingAdapter,
  getBillingAdapter,
  getBillingGatewayStatus
};
