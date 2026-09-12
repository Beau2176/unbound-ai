const verification = require("./verification");
const store = require("./store");
const gateway = require("./gateway");

function normalizeHttpsOrigin(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "https:") return null;
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.origin;
  } catch {
    return null;
  }
}

function assertUser(user) {
  const userId = Number(user?.id);
  const email = String(user?.email || "").trim().toLowerCase();
  const displayName = String(user?.display_name || user?.displayName || "").trim();

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    const error = new Error("A signed-in account is required for email verification.");
    error.code = "EMAIL_VERIFICATION_USER_REQUIRED";
    throw error;
  }
  if (!email || !email.includes("@") || email.length > 254) {
    const error = new Error("The account does not have a valid email address.");
    error.code = "EMAIL_VERIFICATION_EMAIL_INVALID";
    throw error;
  }

  return { userId, email, displayName };
}

function createEmailVerificationService(dependencies = {}) {
  const verificationModule = dependencies.verification || verification;
  const storeModule = dependencies.store || store;
  const gatewayModule = dependencies.gateway || gateway;

  function buildVerificationUrl(token, env = process.env) {
    const origin = normalizeHttpsOrigin(env.PUBLIC_APP_ORIGIN);
    if (!origin) {
      const error = new Error("PUBLIC_APP_ORIGIN must be configured with HTTPS before verification email can be sent.");
      error.code = "EMAIL_VERIFICATION_ORIGIN_INVALID";
      throw error;
    }

    const url = new URL("/verify-email", origin);
    url.hash = new URLSearchParams({ token: String(token || "") }).toString();
    return url.toString();
  }

  async function getStatus({ pool, userId, env = process.env, now = new Date() }) {
    const record = await storeModule.getEmailVerificationRecord(pool, userId);
    const gatewayStatus = gatewayModule.getEmailGatewayStatus(env);
    return verificationModule.buildPublicEmailVerificationStatus(record, gatewayStatus, now);
  }

  async function send({ pool, user, env = process.env, now = new Date() }) {
    const account = assertUser(user);
    const gatewayStatus = gatewayModule.getEmailGatewayStatus(env);
    if (!gatewayStatus.configured || !gatewayStatus.canSendVerification) {
      const error = new Error("Account verification email delivery is not configured.");
      error.code = "EMAIL_PROVIDER_NOT_CONFIGURED";
      throw error;
    }

    const challenge = verificationModule.createVerificationChallenge({ now, env });
    const persisted = await storeModule.createEmailVerificationChallenge(pool, {
      userId: account.userId,
      tokenHash: challenge.tokenHash,
      expiresAt: challenge.expiresAt,
      now: challenge.createdAt
    });

    if (!persisted.created) {
      return {
        sent: false,
        state: persisted.reason === "already-verified" ? "verified" : "unverified",
        reason: persisted.reason
      };
    }

    const verificationUrl = buildVerificationUrl(challenge.token, env);

    try {
      const delivery = await gatewayModule.sendAccountVerification({
        toEmail: account.email,
        displayName: account.displayName,
        verificationUrl,
        env
      });

      if (!delivery?.accepted) {
        throw Object.assign(new Error("Verification email was not accepted for delivery."), {
          code: "EMAIL_VERIFICATION_DELIVERY_REJECTED"
        });
      }
    } catch (cause) {
      await storeModule.markEmailVerificationDeliveryFailed(pool, {
        userId: account.userId,
        tokenHash: challenge.tokenHash,
        now: new Date()
      });

      const error = new Error("Verification email could not be sent.");
      error.code = "EMAIL_VERIFICATION_DELIVERY_FAILED";
      error.cause = cause;
      throw error;
    }

    return {
      sent: true,
      state: "pending",
      expiresAt: challenge.expiresAt.toISOString()
    };
  }

  async function resend(options) {
    return send(options);
  }

  async function consume({ pool, token, env = process.env, now = new Date() }) {
    const tokenHash = verificationModule.hashVerificationToken(token, env);
    return storeModule.consumeEmailVerificationChallenge(pool, {
      tokenHash,
      now
    });
  }

  return {
    buildVerificationUrl,
    getStatus,
    send,
    resend,
    consume
  };
}

const defaultService = createEmailVerificationService();

module.exports = {
  createEmailVerificationService,
  normalizeHttpsOrigin,
  ...defaultService
};
