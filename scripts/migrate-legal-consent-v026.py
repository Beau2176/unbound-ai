from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    path.write_text(text.replace(old, new, 1))


server = Path("app/server.js")
entitlements = Path("app/access/entitlements.js")

one(
    entitlements,
    '''  data_export: Object.freeze({
    label: "Download My Data",
    description: "Download a privacy-safe JSON copy of account data and conversation history.",
    implemented: true,
    minimumPlan: "free"
  }),
  file_analysis: Object.freeze({
''',
    '''  data_export: Object.freeze({
    label: "Download My Data",
    description: "Download a privacy-safe JSON copy of account data and conversation history.",
    implemented: true,
    minimumPlan: "free"
  }),
  legal_consent: Object.freeze({
    label: "Privacy & Terms controls",
    description: "Versioned Terms of Use and Privacy Notice acceptance records with account-visible status.",
    implemented: true,
    minimumPlan: "free"
  }),
  file_analysis: Object.freeze({
''',
    "legal consent entitlement"
)

one(
    server,
    '''const {
  buildExportFilename,
  buildDataExport
} = require("./privacy/data-export");
''',
    '''const {
  buildExportFilename,
  buildDataExport
} = require("./privacy/data-export");
const {
  normalizeLegalDocumentType,
  getLegalDocumentCatalog,
  buildLegalConsentStatus
} = require("./privacy/legal-consent");
''',
    "legal consent imports"
)

one(
    server,
    '''    CREATE TABLE IF NOT EXISTS account_subscriptions (
''',
    '''    CREATE TABLE IF NOT EXISTS account_legal_acceptances (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      document_version TEXT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT account_legal_acceptances_type_check
        CHECK (document_type IN ('terms', 'privacy')),
      UNIQUE(user_id, document_type, document_version)
    );

    CREATE INDEX IF NOT EXISTS account_legal_acceptances_user_idx
      ON account_legal_acceptances(user_id, document_type, accepted_at DESC);

    CREATE TABLE IF NOT EXISTS account_subscriptions (
''',
    "legal consent database table"
)

legal_api = r'''
/* ----------------------- LEGAL CONSENT / POLICIES ---------------------- */

app.get(
  "/api/account/legal",
  requireDatabase,
  requireSignedIn,
  requireCapability("legal_consent"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT document_type, document_version, accepted_at
         FROM account_legal_acceptances
         WHERE user_id = $1
         ORDER BY accepted_at DESC, id DESC`,
        [req.user.id]
      );

      return res.json(buildLegalConsentStatus({ acceptedRows: result.rows }));
    } catch (error) {
      console.error("UNBOUND AI LEGAL STATUS ERROR:", error);
      return res.status(500).json({ error: "Could not load legal acceptance status." });
    }
  }
);

app.post(
  "/api/account/legal/accept",
  requireDatabase,
  requireSignedIn,
  requireCapability("legal_consent"),
  async (req, res) => {
    try {
      const documentType = normalizeLegalDocumentType(req.body?.documentType);
      const requestedVersion = String(req.body?.version || "").trim();
      const currentDocument = getLegalDocumentCatalog().find(
        (document) => document.type === documentType
      );

      if (!documentType || !currentDocument) {
        return res.status(400).json({ error: "Unknown legal document type." });
      }

      if (!requestedVersion || requestedVersion !== currentDocument.version) {
        return res.status(409).json({
          error: "That legal document version is no longer current.",
          currentVersion: currentDocument.version
        });
      }

      await pool.query(
        `INSERT INTO account_legal_acceptances
           (user_id, document_type, document_version)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, document_type, document_version) DO NOTHING`,
        [req.user.id, documentType, currentDocument.version]
      );

      await writeSecurityEvent(
        pool,
        req.user.id,
        "account.legal_accepted",
        null,
        {
          documentType,
          version: currentDocument.version
        }
      );

      const result = await pool.query(
        `SELECT document_type, document_version, accepted_at
         FROM account_legal_acceptances
         WHERE user_id = $1
         ORDER BY accepted_at DESC, id DESC`,
        [req.user.id]
      );

      return res.json(buildLegalConsentStatus({ acceptedRows: result.rows }));
    } catch (error) {
      console.error("UNBOUND AI LEGAL ACCEPT ERROR:", error);
      return res.status(500).json({ error: "Could not record legal acceptance." });
    }
  }
);

'''

one(
    server,
    '''/* ------------------------- CONVERSATION HISTORY ------------------------ */
''',
    legal_api + '''/* ------------------------- CONVERSATION HISTORY ------------------------ */
''',
    "legal consent API"
)

print("Applied UNBOUND AI v0.26 legal consent backend.")
