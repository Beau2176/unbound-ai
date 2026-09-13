const crypto = require("crypto");

const PROVIDER_ID = "segpay";
const CONSUMER_PORTAL_URL = "https://cs.segpay.com/";
const CHECKOUT_TTL_SECONDS = 30 * 60;
const SUBJECT_CHUNK_SIZE = 32;

const capabilities = Object.freeze({
  checkout: true,
  customerPortal: true,
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

function normalizeAmount(value) {
  const text = String(value || "").trim();
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toFixed(2);
}

function normalizePageRef(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/.test(text) ? text : null;
}

function getSegpayConfig(env = process.env) {
  const payPageRef = normalizePageRef(env.SEGPAY_PAY_PAGE_REF);
  const signingKey = safeText(env.SEGPAY_SIGNING_KEY, 500);
  const topAmount = normalizeAmount(env.SEGPAY_TOP_AMOUNT);
  const postbackUsername = safeText(env.SEGPAY_POSTBACK_USERNAME, 200);
  const postbackPassword = safeText(env.SEGPAY_POSTBACK_PASSWORD, 300);
  const merchantApprovalVerified = truthy(env.SEGPAY_MERCHANT_APPROVAL_VERIFIED);
  const signedCheckoutFieldsVerified = truthy(env.SEGPAY_SIGNED_CHECKOUT_FIELDS_VERIFIED);
  const postbackAuthVerified = truthy(env.SEGPAY_POSTBACK_AUTH_VERIFIED);

  return {
    payPageRef,
    signingKey,
    topAmount,
    postbackUsername,
    postbackPassword,
    merchantApprovalVerified,
    signedCheckoutFieldsVerified,
    postbackAuthVerified,
    configured: Boolean(
      payPageRef &&
      signingKey &&
      topAmount &&
      postbackUsername &&
      postbackPassword &&
      merchantApprovalVerified &&
      signedCheckoutFieldsVerified &&
      postbackAuthVerified
    )
  };
}

function splitSubject(subject) {
  const text = String(subject || "").trim();
  if (!/^[A-Za-z0-9._~-]{33,64}$/.test(text)) {
    const error = new Error("Segpay billing subject is invalid.");
    error.code = "SEGPAY_SUBJECT_INVALID";
    throw error;
  }
  return {
    part1: text.slice(0, SUBJECT_CHUNK_SIZE),
    part2: text.slice(SUBJECT_CHUNK_SIZE)
  };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signJwtHs256({ payload, signingKey }) {
  const header = { typ: "JWT", alg: "HS256" };
  const encodedHeader = base64urlJson(header);
  const encodedPayload = base64urlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(signingInput, "utf8")
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function createCheckoutToken({
  subject,
  env = process.env,
  nowMs = Date.now(),
  jti = crypto.randomUUID()
} = {}) {
  const config = getSegpayConfig(env);
  if (!config.configured) {
    const error = new Error("Segpay billing is not fully configured.");
    error.code = "SEGPAY_NOT_CONFIGURED";
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
      amount: config.topAmount,
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
  const config = getSegpayConfig(env);
  if (!config.postbackUsername || !config.postbackPassword) return null;
  return `Basic ${Buffer.from(
    `${config.postbackUsername}:${config.postbackPassword}`,
    "utf8"
  ).toString("base64")}`;
}

function appendParam(map, key, value) {
  const normalizedKey = String(key || "").trim().toLowerCase();
  if (!normalizedKey) return;
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (item === undefined || item === null) continue;
    const normalizedValue = String(item).trim();
    if (!normalizedValue) continue;
    if (map.has(normalizedKey) && map.get(normalizedKey) !== normalizedValue) {
      const error = new Error("Segpay postback contains conflicting parameters.");
      error.code = "SEGPAY_POSTBACK_PARAMETER_CONFLICT";
      throw error;
    }
    map.set(normalizedKey, normalizedValue);
  }
}

function parsePostbackParameters({ rawBody, query = null } = {}) {
  const params = new Map();
  if (Buffer.isBuffer(rawBody) && rawBody.length) {
    const bodyParams = new URLSearchParams(rawBody.toString("utf8"));
    for (const [key, value] of bodyParams.entries()) {
      appendParam(params, key, value);
    }
  }
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      appendParam(params, key, value);
    }
  }
  return Object.fromEntries(params.entries());
}

function reconstructSubject(params) {
  const part1 = safeText(params.ref1, SUBJECT_CHUNK_SIZE);
  const part2 = safeText(params.ref2, SUBJECT_CHUNK_SIZE);
  if (!part1 || !part2) return null;
  const subject = part1 + part2;
  return /^[A-Za-z0-9._~-]{33,64}$/.test(subject) ? subject : null;
}

function parseSegpayTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  // Parse the provider's GMT form before Date's host-local string parser.
  const cleaned = text.replace(/\s*\(GMT[^)]*\)\s*$/i, "").trim();
  const match = cleaned.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i
  );
  if (!match) {
    const direct = new Date(text);
    return Number.isFinite(direct.getTime()) ? direct.toISOString() : null;
  }
  let hour = Number(match[4]);
  const meridiem = match[7].toUpperCase();
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (meridiem === "PM" && hour !== 12) hour += 12;
  const ms = Date.UTC(
    Number(match[3]),
    Number(match[1]) - 1,
    Number(match[2]),
    hour,
    Number(match[5]),
    Number(match[6])
  );
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeWord(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function mapSubscriptionState(params) {
  const action = normalizeWord(params.action);
  const tranType = normalizeWord(params.trantype);
  const stage = normalizeWord(params.stage);
  const approved = normalizeWord(params.approved);

  if (action === "enable" || action === "reactivation") {
    return { status: "active", cancelAtPeriodEnd: false };
  }
  if (action === "cancel") {
    return { status: "active", cancelAtPeriodEnd: true };
  }
  if (action === "disable") {
    return { status: "canceled", cancelAtPeriodEnd: false };
  }

  if (action === "void") {
    return { status: "canceled", cancelAtPeriodEnd: false };
  }

  if (action === "auth") {
    if (["credit", "charge", "revoke", "rdrreversal"].includes(tranType)) {
      return { status: "canceled", cancelAtPeriodEnd: false };
    }
    if (tranType === "cbreversal") {
      return { status: "active", cancelAtPeriodEnd: false };
    }
    if (tranType === "sale") {
      if (approved === "yes") {
        return { status: "active", cancelAtPeriodEnd: false };
      }
      if (approved === "no") {
        return {
          status: stage === "initial" ? "incomplete" : "past_due",
          cancelAtPeriodEnd: false
        };
      }
    }
  }

  return { status: "none", cancelAtPeriodEnd: false };
}

function stableEventId(params) {
  const action = normalizeWord(params.action) || "event";
  const tranId = safeText(params.tranid, 200);
  const purchaseId = safeText(params.purchaseid, 200) || "unknown";
  if (tranId) {
    return `segpay:${purchaseId}:${tranId}:${action}`.slice(0, 300);
  }
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const digest = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  return `segpay:${purchaseId}:${action}:${digest}`.slice(0, 300);
}

function addDays(timestamp, days) {
  const start = new Date(timestamp);
  const count = Number.parseInt(String(days || ""), 10);
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(count) || count <= 0 || count > 3660) {
    return null;
  }
  return new Date(start.getTime() + count * 86_400_000).toISOString();
}

async function startCheckout({ subject, planTier, env = process.env } = {}) {
  if (String(planTier || "").trim().toLowerCase() !== "top") {
    const error = new Error("Segpay checkout only supports the TOP plan.");
    error.code = "SEGPAY_PLAN_UNSUPPORTED";
    throw error;
  }
  const config = getSegpayConfig(env);
  if (!config.configured) {
    const error = new Error("Segpay billing is not fully configured.");
    error.code = "SEGPAY_NOT_CONFIGURED";
    throw error;
  }
  const checkout = createCheckoutToken({ subject, env });
  const checkoutUrl = new URL(`https://pay.segpay.com/${config.payPageRef}`);
  checkoutUrl.searchParams.set("jwt", checkout.token);
  return {
    checkoutUrl: checkoutUrl.toString(),
    expiresAt: checkout.expiresAt
  };
}

async function startCustomerPortal() {
  return {
    portalUrl: CONSUMER_PORTAL_URL,
    expiresAt: null
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
  const purchaseId = safeText(params.purchaseid, 200);
  const state = mapSubscriptionState(params);
  if (!subject || !purchaseId || state.status === "none") {
    return {
      eventId: null,
      subject: null,
      status: "none",
      planTier: "top",
      occurredAt: null
    };
  }

  const eventTimestamp =
    parseSegpayTimestamp(params.transtime) ||
    parseSegpayTimestamp(params.reactivationtimestamp) ||
    new Date(now).toISOString();
  const currentPeriodEnd = state.status === "active"
    ? addDays(eventTimestamp, params.rint)
    : null;
  const action = normalizeWord(params.action) || "event";
  const stage = normalizeWord(params.stage);
  const eventType = ["enable", "disable", "cancel", "reactivation"].includes(action)
    ? `subscription.${action}`
    : `transaction.${normalizeWord(params.trantype) || "unknown"}.${action}${stage ? `.${stage}` : ""}`;

  return {
    eventId: stableEventId(params),
    eventType,
    subject,
    customerId: safeText(params.paymentaccountid, 300) || purchaseId,
    subscriptionId: purchaseId,
    status: state.status,
    planTier: "top",
    currentPeriodStart: state.status === "active" ? eventTimestamp : null,
    currentPeriodEnd,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    occurredAt: eventTimestamp
  };
}

const segpayBillingAdapter = Object.freeze({
  id: PROVIDER_ID,
  capabilities,
  isConfigured(env = process.env) {
    return getSegpayConfig(env).configured;
  },
  startCheckout,
  startCustomerPortal,
  verifyWebhook,
  parseWebhook
});

module.exports = {
  PROVIDER_ID,
  CONSUMER_PORTAL_URL,
  CHECKOUT_TTL_SECONDS,
  SUBJECT_CHUNK_SIZE,
  capabilities,
  truthy,
  normalizeAmount,
  normalizePageRef,
  getSegpayConfig,
  splitSubject,
  signJwtHs256,
  createCheckoutToken,
  parsePostbackParameters,
  reconstructSubject,
  parseSegpayTimestamp,
  mapSubscriptionState,
  stableEventId,
  segpayBillingAdapter
};
