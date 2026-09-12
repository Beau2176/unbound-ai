const AGE_VERIFICATION_STATUSES = Object.freeze([
  "unverified",
  "pending",
  "verified",
  "failed",
  "expired",
  "revoked"
]);

function normalizeProvider(value) {
  return String(value || "").trim().toLowerCase();
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

function getAgeVerificationGatewayStatus(env = process.env) {
  const provider = normalizeProvider(env.AGE_VERIFICATION_PROVIDER);

  if (!provider) {
    return {
      provider: null,
      configured: false,
      state: "provider-not-selected",
      minimumAge: 18,
      storesRawIdentityEvidence: false,
      storesBiometricTemplates: false,
      startVerification: false,
      webhooks: false
    };
  }

  return {
    provider,
    configured: false,
    state: "adapter-not-installed",
    minimumAge: 18,
    storesRawIdentityEvidence: false,
    storesBiometricTemplates: false,
    startVerification: false,
    webhooks: false
  };
}

module.exports = {
  AGE_VERIFICATION_STATUSES,
  normalizeAgeVerificationStatus,
  ageVerificationAllowsAdultAccess,
  getAgeVerificationGatewayStatus
};
