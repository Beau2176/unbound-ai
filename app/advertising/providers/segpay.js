const crypto = require("crypto");
const {
  SUBJECT_CHUNK_SIZE,
  splitSubject,
  signJwtHs256,
  parsePostbackParameters,
  reconstructSubject,
  parseSegpayTimestamp,
  stableEventId
} = require("../../billing/providers/segpay");

const PROVIDER_ID = "segpay";
const CHECKOUT_TTL_SECONDS = 30 * 60;

const capabilities = Object.freeze({
  checkout: true,
  webhooks: true
});

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function safeText(value, maxLength = 300) {
  const text = String(value ?? "").trim();
  return text && text.length <= maxLength ? text : null;
}

function normalizePageRef(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(text) ? text : null;
}

function normalizeCurrency(value) {
  const text = String(value || "USD").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

function amountFromCents(value) {
  const cents = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000_000) return null;
  return (cents / 100).toFixed(2);
}

function getSegpayAdvertisingConfig(env = process.env) {
  const payPageRef = normalizePageRef(env.SEGPAY_ADVERTISING_PAY_PAGE_REF);
  const signingKey = safeText(env.SEGPAY_ADVERTISING_SIGNING_KEY, 500);
  const postbackUsername = safeText(env.SEGPAY_ADVERTISING_POSTBACK_USERNAME, 200);
  const postbackPassword = safeText(env.SEGPAY_ADVERTISING_POSTBACK_PASSWORD, 300);
  const currency = normalizeCurrency(env.SEGPAY_ADVERTISING_CURRENCY || "USD");
  const merchantApprovalVerified = truthy(env.SEGPAY_ADVERTISING_MERCHANT_APPROVAL_VERIFIED);
  const oneTimePricingVerified = truthy(env.SEGPAY_ADVERTISING_ONE_TIME_PRICING_VERIFIED);
  const signedFieldsVerified = truthy(env.SEGPAY_ADVERTISING_SIGNED_FIELDS_VERIFIED);
  const postbackAuthVerified = truthy(env.SEGPAY_ADVERTISING_POSTBACK_AUTH_VERIFIED);

  return {
    payPageRef,
    signingKey,
    postbackUsername,
    postbackPassword,
    currency,
    merchantApprovalVerified,
    oneTimePricingVerified,
    signedFieldsVerified,
    postbackAuthVerified,
    configured: Boolean(
      payPageRef &&
      signingKey &&
      postbackUsername &&
      postbackPassword &&
      currency &&
      merchantApprovalVerified &&
      oneTimePricingVerified &&
      signedFieldsVerified &&
      postbackAuthVerified
    )
  };
}

function createAdvertisingCheckoutToken({
  subject,
  amountCents,
  currency,
  env = process.env,
  nowMs = Date.now(),
  jti = crypto.randomUUID()
} = {}) {
  const config = getSegpayAdvertisingConfig(env);
  if (!config.configured) {
    const error = new Error("Segpay advertising checkout is not fully configured.");
    error.code = "SEGPAY_ADVERTISING_NOT_CONFIGURED";
    throw error;
  }

  const amount = amountFromCents(amountCents);
  const normalizedCurrency = normalizeCurrency(currency);
  if (!amount || normalizedCurrency !== config.currency) {
    const error = new Error("Segpay advertising amount or currency is invalid.");
    error.code = "SEGPAY_ADVERTISING_AMOUNT_INVALID";
    throw error;
  }

  const split = splitSubject(subject);
  const iat = Math.floor(Number(nowMs) / 1000);
  const exp = iat + CHECKOUT_TTL_SECONDS;
  const payload = {
    iat,
    exp,
    jti: String(jti),
    pageref: config.payPageRef,
    fields: {
      amount,
      REF1: split.part1,
      REF2: split.part2
    }
  };

  return {
    token: signJwtHs256({ payload, signingKey: config.signingKey }),
    payload,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

function constantTimeEqual(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left || ""), "utf8").digest();
  const rightDigest = crypto.createHash("sha256").update(String(right || ""), "utf8").digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function expectedBasicAuthorization(env = process.env) {
  const config = getSegpayAdvertisingConfig(env);
  if (!config.postbackUsername || !config.postbackPassword) return null;
  return `Basic ${Buffer.from(
    `${config.postbackUsername}:${config.postbackPassword}`,
    "utf8"
  ).toString("base64")}`;
}

function normalizeWord(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function mapAdvertisingPaymentStatus(params = {}) {
  const action = normalizeWord(params.action);
  const tranType = normalizeWord(params.trantype);
  const approved = normalizeWord(params.approved);

  if (tranType === "sale" && action === "auth") {
    if (approved === "yes") return "paid";
    if (approved === "no") return "failed";
  }
  if (tranType === "sale" && action === "void") return "canceled";
  if (["credit", "charge", "revoke", "rdrreversal"].includes(tranType) && action === "auth") {
    return "refunded";
  }
  if (tranType === "cbreversal" && action === "auth") return "paid";
  return null;
}

async function startCheckout({
  subject,
  productType,
  productCode,
  amountCents,
  currency,
  env = process.env
} = {}) {
  if (String(productType || "").trim().toLowerCase() !== "advertising") {
    const error = new Error("Segpay advertising checkout only supports advertising purchases.");
    error.code = "SEGPAY_ADVERTISING_PRODUCT_UNSUPPORTED";
    throw error;
  }
  if (!safeText(productCode, 60)) {
    const error = new Error("Segpay advertising package is invalid.");
    error.code = "SEGPAY_ADVERTISING_PACKAGE_INVALID";
    throw error;
  }

  const config = getSegpayAdvertisingConfig(env);
  if (!config.configured) {
    const error = new Error("Segpay advertising checkout is not fully configured.");
    error.code = "SEGPAY_ADVERTISING_NOT_CONFIGURED";
    throw error;
  }

  const checkout = createAdvertisingCheckoutToken({
    subject,
    amountCents,
    currency,
    env
  });
  const checkoutUrl = new URL(`https://pay.segpay.com/${config.payPageRef}`);
  checkoutUrl.searchParams.set("jwt", checkout.token);
  return {
    checkoutUrl: checkoutUrl.toString(),
    expiresAt: checkout.expiresAt
  };
}

async function verifyWebhook({ headers = {}, env = process.env } = {}) {
  const expected = expectedBasicAuthorization(env);
  if (!expected) return false;
  const presented = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  return Boolean(presented && constantTimeEqual(presented, expected));
}

async function parseWebhook({ rawBody, query = null, now = new Date() } = {}) {
  const params = parsePostbackParameters({ rawBody, query });
  const subject = reconstructSubject(params);
  const paymentStatus = mapAdvertisingPaymentStatus(params);
  const purchaseId = safeText(params.purchaseid, 200);
  const occurredAt = parseSegpayTimestamp(params.transtime) || new Date(now).toISOString();
  if (!subject || !purchaseId || !paymentStatus || !occurredAt) {
    return {
      eventId: null,
      eventType: null,
      subject: null,
      paymentStatus: null,
      occurredAt: null
    };
  }

  const tranType = normalizeWord(params.trantype) || "unknown";
  const action = normalizeWord(params.action) || "event";
  const stage = normalizeWord(params.stage);
  return {
    eventId: stableEventId(params),
    eventType: `transaction.${tranType}.${action}${stage ? `.${stage}` : ""}`,
    subject,
    paymentStatus,
    occurredAt
  };
}

const segpayAdvertisingAdapter = Object.freeze({
  id: PROVIDER_ID,
  capabilities,
  isConfigured(env = process.env) {
    return getSegpayAdvertisingConfig(env).configured;
  },
  startCheckout,
  verifyWebhook,
  parseWebhook
});

module.exports = {
  PROVIDER_ID,
  CHECKOUT_TTL_SECONDS,
  SUBJECT_CHUNK_SIZE,
  capabilities,
  truthy,
  safeText,
  normalizePageRef,
  normalizeCurrency,
  amountFromCents,
  getSegpayAdvertisingConfig,
  createAdvertisingCheckoutToken,
  expectedBasicAuthorization,
  mapAdvertisingPaymentStatus,
  segpayAdvertisingAdapter
};
