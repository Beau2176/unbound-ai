from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("app/server.js")
text = path.read_text()

text = replace_once(
    text,
    '''const {
  normalizeLegalDocumentType,
  getLegalDocumentCatalog,
  buildLegalConsentStatus
} = require("./privacy/legal-consent");
''',
    '''const {
  normalizeLegalDocumentType,
  getLegalDocumentCatalog,
  legalPublishingState,
  buildLegalConsentStatus
} = require("./privacy/legal-consent");
''',
    "legal publishing import",
)

text = replace_once(
    text,
    '''const {
  getRequestObservabilitySnapshot,
  createRequestObservabilityMiddleware
} = require("./ops/request-observability");
''',
    '''const {
  getRequestObservabilitySnapshot,
  createRequestObservabilityMiddleware
} = require("./ops/request-observability");
const { buildLaunchReadiness } = require("./ops/launch-readiness");
''',
    "launch readiness import",
)

text = replace_once(
    text,
    '''/* ----------------------------- ADMIN API ----------------------------- */

app.get(
  "/api/admin/ops/recovery",
''',
    '''function buildCurrentOperationalSnapshot() {
  const maintenance = getMaintenanceStatus();
  const ai = getGatewayStatus();
  const runtime = buildReadinessStatus({
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseReady,
    databaseError,
    shuttingDown,
    maintenanceStatus: maintenance,
    aiStatus: ai
  });
  const recovery = buildRecoveryReadiness();
  const legal = legalPublishingState();
  const billing = getBillingGatewayStatus();
  const ageVerification = getAgeVerificationGatewayStatus();
  const launch = buildLaunchReadiness({
    runtime,
    maintenance,
    recovery,
    legal,
    billing,
    ageVerification,
    ai
  });

  return {
    runtime,
    maintenance,
    recovery,
    legal,
    billing,
    ageVerification,
    ai,
    launch,
    http: getRequestObservabilitySnapshot()
  };
}

/* ----------------------------- ADMIN API ----------------------------- */

app.get(
  "/api/admin/ops/recovery",
''',
    "operational snapshot helper",
)

old_status = '''app.get(
  "/api/admin/ops/status",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    const maintenance = getMaintenanceStatus();
    return res.json({
      runtime: buildReadinessStatus({
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        databaseReady,
        databaseError,
        shuttingDown,
        maintenanceStatus: maintenance,
        aiStatus: getGatewayStatus()
      }),
      maintenance,
      recovery: buildRecoveryReadiness(),
      http: getRequestObservabilitySnapshot()
    });
  }
);
'''

new_status = '''app.get(
  "/api/admin/ops/launch-readiness",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    const snapshot = buildCurrentOperationalSnapshot();
    return res.json({ launch: snapshot.launch });
  }
);

app.get(
  "/api/admin/ops/status",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    return res.json(buildCurrentOperationalSnapshot());
  }
);
'''

text = replace_once(text, old_status, new_status, "ops status endpoint")

path.write_text(text)
print("Applied commercial launch readiness v0.37 integration.")
