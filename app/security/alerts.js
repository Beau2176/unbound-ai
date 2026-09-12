const ALERT_SEVERITIES = new Set(["info", "warning", "critical"]);

function normalizeAlertSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ALERT_SEVERITIES.has(normalized) ? normalized : "info";
}

function buildNewDeviceAlert({ label, authMethod, replacedRevokedDevice = false } = {}) {
  const deviceLabel = String(label || "Unknown device").slice(0, 80);
  const method = String(authMethod || "sign-in").slice(0, 40);
  const replaced = Boolean(replacedRevokedDevice);

  return {
    eventType: replaced ? "device.revoked_token_reused" : "device.new_sign_in",
    severity: replaced ? "critical" : "warning",
    title: replaced ? "Revoked device tried to return" : "New device signed in",
    message: replaced
      ? `${deviceLabel} signed in using a browser/device identity that had previously been revoked. UNBOUND issued a fresh device identity and kept the old one revoked.`
      : `${deviceLabel} signed in using ${method}. If this was not you, open Account Security and revoke the device.`
  };
}

function getSecurityAlertStatus() {
  return {
    configured: true,
    storage: "postgresql",
    delivery: "in-app",
    emailAdapterConnected: false,
    smsAdapterConnected: false,
    rawIpStored: false,
    persistentUntilAcknowledged: true
  };
}

module.exports = {
  normalizeAlertSeverity,
  buildNewDeviceAlert,
  getSecurityAlertStatus
};
