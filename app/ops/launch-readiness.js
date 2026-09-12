const LAUNCH_PROFILE = "commercial_adult";

function safeText(value, maxLength = 240) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function addCheck(checks, key, label, ready, detail) {
  checks.push({
    key,
    label,
    ready: Boolean(ready),
    severity: "blocker",
    detail: safeText(detail, 500)
  });
}

function buildLaunchReadiness({
  runtime = null,
  maintenance = null,
  infrastructure = null,
  recovery = null,
  legal = null,
  billing = null,
  ageVerification = null,
  emailDelivery = null,
  ai = null,
  nowMs = Date.now()
} = {}) {
  const checks = [];

  addCheck(
    checks,
    "runtime_operational",
    "Runtime operational",
    runtime?.ready === true && runtime?.operational === true,
    runtime?.status
      ? `Runtime status: ${runtime.status}.`
      : "Runtime readiness has not been verified."
  );

  addCheck(
    checks,
    "maintenance_off",
    "Maintenance mode off",
    maintenance?.active !== true,
    maintenance?.active
      ? `Maintenance mode is ${safeText(maintenance.mode, 40) || "active"}.`
      : "No maintenance gate is active."
  );

  addCheck(
    checks,
    "infrastructure_production",
    "Production infrastructure verified",
    infrastructure?.launchReady === true,
    infrastructure?.launchReady
      ? "Always-on compute, durable database, platform health check, and a current infrastructure review are verified."
      : infrastructure?.blockers?.[0] || "Production infrastructure readiness has not been verified."
  );

  addCheck(
    checks,
    "ai_chat",
    "AI chat provider ready",
    ai?.configured === true && ai?.streaming === true,
    ai?.configured
      ? `Provider ${safeText(ai.provider, 80) || "configured"}; streaming ${ai.streaming ? "available" : "unavailable"}.`
      : `AI provider is not configured${ai?.error ? ` (${safeText(ai.error, 120)})` : ""}.`
  );

  addCheck(
    checks,
    "research_mode",
    "Research Mode provider support",
    ai?.configured === true && ai?.research === true,
    ai?.research
      ? "The configured AI provider supports Research Mode."
      : "The configured AI provider does not currently provide Research Mode support."
  );

  addCheck(
    checks,
    "database_recovery",
    "Database recovery protection",
    recovery?.launchReady === true,
    recovery?.launchReady
      ? "Backup protection and a current restore drill are recorded."
      : recovery?.blockers?.[0] || "Database backup/restore readiness is not verified."
  );

  addCheck(
    checks,
    "legal_published",
    "Terms and Privacy published",
    legal?.documentsPublished === true,
    legal?.documentsPublished
      ? "Current non-draft Terms and Privacy documents have published URLs."
      : "Final non-draft Terms and Privacy documents with published URLs are required."
  );

  addCheck(
    checks,
    "legal_enforcement",
    "Legal consent enforcement enabled",
    legal?.acceptanceEnabled === true && legal?.enforcementEnabled === true,
    legal?.enforcementEnabled
      ? "Current policy acceptance and enforcement are enabled."
      : "Policy acceptance and enforcement must be enabled after final policies are published."
  );

  const emailReady = emailDelivery?.launchReady === true;
  addCheck(
    checks,
    "transactional_email",
    "Transactional account email verified",
    emailReady,
    emailReady
      ? `Transactional email provider ${safeText(emailDelivery.provider, 80) || "configured"} has verified sender identity, production access, and a current delivery review.`
      : emailDelivery?.blockers?.[0] || "Transactional account email delivery has not been verified end-to-end."
  );

  const billingReady = Boolean(
    billing?.configured === true &&
    billing?.checkout === true &&
    billing?.customerPortal === true &&
    billing?.webhooks === true
  );
  addCheck(
    checks,
    "billing_gateway",
    "Commercial billing gateway ready",
    billingReady,
    billingReady
      ? `Billing provider ${safeText(billing.provider, 80) || "configured"} supports checkout, customer portal, and webhooks.`
      : `Billing is incomplete${billing?.state ? ` (${safeText(billing.state, 120)})` : ""}; checkout, customer portal, and webhooks are required.`
  );

  const minimumAge = Number(ageVerification?.minimumAge || 0);
  const ageReady = Boolean(
    ageVerification?.configured === true &&
    ageVerification?.startVerification === true &&
    ageVerification?.webhooks === true &&
    minimumAge >= 18
  );
  addCheck(
    checks,
    "age_verification_gateway",
    "Hard 18+ age-verification gateway ready",
    ageReady,
    ageReady
      ? `Age verification is configured for ${minimumAge}+ with start flow and webhooks.`
      : `Hard 18+ verification is incomplete${ageVerification?.state ? ` (${safeText(ageVerification.state, 120)})` : ""}; a configured start flow and webhooks are required.`
  );

  const blockers = checks
    .filter((check) => !check.ready)
    .map((check) => ({
      key: check.key,
      label: check.label,
      detail: check.detail
    }));

  const launchReady = blockers.length === 0;

  return {
    profile: LAUNCH_PROFILE,
    status: launchReady ? "ready" : "blocked",
    launchReady,
    blockerCount: blockers.length,
    checkedAt: new Date(nowMs).toISOString(),
    disclaimer:
      "Engineering and operational launch gate only; this is not legal advice, regulatory certification, or a substitute for professional compliance review.",
    checks,
    blockers
  };
}

module.exports = {
  LAUNCH_PROFILE,
  buildLaunchReadiness
};
