function positiveInt(value, fallback, { min = 1, max = 1000 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getSignInRiskConfig(env = process.env) {
  return Object.freeze({
    failedPasswordThreshold: positiveInt(
      env.SECURITY_FAILED_LOGIN_ALERT_THRESHOLD,
      3,
      { min: 2, max: 20 }
    ),
    failedPasswordWindowMinutes: positiveInt(
      env.SECURITY_FAILED_LOGIN_ALERT_WINDOW_MINUTES,
      15,
      { min: 5, max: 1440 }
    )
  });
}

function buildRepeatedFailureAlert({ count, windowMinutes } = {}) {
  const attempts = Math.max(1, Number(count || 0));
  const minutes = Math.max(1, Number(windowMinutes || 15));
  return {
    eventType: "auth.repeated_failed_sign_in",
    severity: "warning",
    title: "Repeated failed sign-in attempts",
    message: `${attempts} failed password sign-in attempts were recorded on your account within about ${minutes} minute(s). If this was not you, review Account Security and consider changing your password.`
  };
}

function getSignInRiskStatus(env = process.env) {
  const config = getSignInRiskConfig(env);
  return {
    configured: true,
    rawIpStored: false,
    source: "account-security-events",
    failedPasswordThreshold: config.failedPasswordThreshold,
    failedPasswordWindowMinutes: config.failedPasswordWindowMinutes
  };
}

module.exports = {
  getSignInRiskConfig,
  buildRepeatedFailureAlert,
  getSignInRiskStatus
};
