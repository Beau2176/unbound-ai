function isoDatePart(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "export";
  return date.toISOString().slice(0, 10);
}

function buildExportFilename(value = new Date()) {
  return `unbound-ai-data-${isoDatePart(value)}.json`;
}

function buildDataExport({
  account,
  preferences,
  access,
  conversations = [],
  devices = [],
  securityEvents = [],
  securityAlerts = [],
  passkeys = [],
  recovery,
  usage = [],
  entitlementOverrides = [],
  features = {},
  exportedAt = new Date().toISOString()
} = {}) {
  return {
    exportVersion: 2,
    product: "UNBOUND AI",
    exportedAt,
    privacy: {
      excludesAuthenticationSecrets: true,
      excludedExamples: [
        "password hashes",
        "session tokens and token hashes",
        "device authentication tokens and hashes",
        "recovery-code hashes",
        "passkey credential IDs and public keys",
        "provider response IDs",
        "age-verification provider reference hashes",
        "connected-app access/refresh tokens and OAuth authorization state",
        "worker claim tokens and external coding-provider job IDs"
      ]
    },
    account: account || null,
    preferences: preferences || null,
    access: access || null,
    conversations: Array.isArray(conversations) ? conversations : [],
    features,
    security: {
      devices: Array.isArray(devices) ? devices : [],
      events: Array.isArray(securityEvents) ? securityEvents : [],
      alerts: Array.isArray(securityAlerts) ? securityAlerts : [],
      passkeys: Array.isArray(passkeys) ? passkeys : [],
      recovery: recovery || null
    },
    usage: Array.isArray(usage) ? usage : [],
    entitlementOverrides: Array.isArray(entitlementOverrides)
      ? entitlementOverrides
      : []
  };
}

module.exports = {
  buildExportFilename,
  buildDataExport
};
