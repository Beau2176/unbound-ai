const verificationService = require("./service");
const { buildEmailDeliveryReadiness } = require("./readiness");

const SAFE_STATES = new Set([
  "unverified",
  "pending",
  "verified",
  "expired",
  "failed"
]);

function normalizeSafeState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SAFE_STATES.has(normalized) ? normalized : "unknown";
}

async function attemptRegistrationEmailVerification({
  pool,
  user,
  env = process.env,
  nowMs = Date.now(),
  readinessBuilder = buildEmailDeliveryReadiness,
  service = verificationService
} = {}) {
  let launchReady = false;

  try {
    const readiness = readinessBuilder({ env, nowMs });
    launchReady = readiness?.launchReady === true;

    if (!launchReady) {
      return {
        attempted: false,
        sent: false,
        state: "not-ready"
      };
    }

    const result = await service.send({ pool, user, env });
    return {
      attempted: true,
      sent: result?.sent === true,
      state: normalizeSafeState(result?.state)
    };
  } catch (_error) {
    return {
      attempted: launchReady,
      sent: false,
      state: "failed"
    };
  }
}

module.exports = {
  attemptRegistrationEmailVerification,
  normalizeSafeState
};
