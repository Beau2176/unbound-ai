from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    path.write_text(text.replace(old, new, 1))


server = Path("app/server.js")

one(
    server,
    '''const {
  normalizeLegalDocumentType,
  getLegalDocumentCatalog,
  buildLegalConsentStatus
} = require("./privacy/legal-consent");
''',
    '''const {
  normalizeLegalDocumentType,
  getLegalDocumentCatalog,
  buildLegalConsentStatus
} = require("./privacy/legal-consent");
const {
  buildLivenessStatus,
  buildReadinessStatus
} = require("./ops/runtime-status");
''',
    "runtime status imports"
)

one(
    server,
    '''let pool = null;
let databaseReady = false;
let databaseError = null;

function createPool() {
''',
    '''let pool = null;
let databaseReady = false;
let databaseError = null;

function sendStatusJson(res, statusCode, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(statusCode).json(payload);
}

app.get("/healthz", (req, res) => {
  return sendStatusJson(res, 200, buildLivenessStatus());
});

app.get("/readyz", (req, res) => {
  const payload = buildReadinessStatus({
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseReady,
    databaseError,
    aiStatus: getGatewayStatus()
  });

  return sendStatusJson(res, payload.ready ? 200 : 503, payload);
});

app.get("/api/system/status", (req, res) => {
  const payload = buildReadinessStatus({
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseReady,
    databaseError,
    aiStatus: getGatewayStatus()
  });

  return sendStatusJson(res, payload.ready ? 200 : 503, payload);
});

function createPool() {
''',
    "operational health routes"
)

print("Applied UNBOUND AI v0.28 operational health endpoints.")
