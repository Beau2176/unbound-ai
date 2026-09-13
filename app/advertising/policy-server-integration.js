const INTEGRATION_VERSION = "v0.83";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Advertising policy integration marker is missing: ${label}.`);
    error.code = "ADVERTISING_POLICY_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Advertising policy integration marker is ambiguous: ${label}.`);
    error.code = "ADVERTISING_POLICY_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateAdvertisingPolicyServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "ADVERTISING_POLICY_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const analyticsImport = `const {\n  recordAdvertisingImpressions,\n  recordAdvertisingClick,\n  loadAdvertisingMetrics\n} = require("./advertising/analytics");`;
  source = replaceExactlyOnce(
    source,
    analyticsImport,
    `${analyticsImport}\nconst {\n  normalizeAdvertisingReviewDecision,\n  publicAdvertisingPolicy\n} = require("./advertising/policy");`,
    "advertising-policy-import"
  );

  const schemaMarker = `    CREATE TABLE IF NOT EXISTS advertising_metrics_daily (`;
  source = replaceExactlyOnce(
    source,
    schemaMarker,
    `    ALTER TABLE advertising_orders\n      ADD COLUMN IF NOT EXISTS review_policy_version TEXT;\n\n    ALTER TABLE advertising_orders\n      ADD COLUMN IF NOT EXISTS review_attestation JSONB NOT NULL DEFAULT '{}'::jsonb;\n\n    ALTER TABLE advertising_orders\n      ADD COLUMN IF NOT EXISTS review_notes TEXT;\n\n${schemaMarker}`,
    "advertising-policy-schema"
  );

  const pageMarker = `app.get("/advertising-admin", requireDatabase, requireAdmin, (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    pageMarker,
    `app.get("/advertising-policy.html", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "advertising-policy.html"));\n});\n${pageMarker}`,
    "advertising-policy-page"
  );

  const catalogMarker = `app.get("/api/advertising/catalog", requireDatabase, async (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    catalogMarker,
    `app.get("/api/advertising/policy", (req, res) => {\n  return res.json({ policy: publicAdvertisingPolicy() });\n});\n\n${catalogMarker}`,
    "advertising-policy-api"
  );

  const adminSelectMarker = `              featured, business_name, contact_email, website_url, headline, description,\n              payment_status, review_status, reviewed_at, starts_at, ends_at, created_at`;
  source = replaceExactlyOnce(
    source,
    adminSelectMarker,
    `              featured, business_name, contact_email, website_url, headline, description,\n              payment_status, review_status, review_policy_version, review_attestation, review_notes,\n              reviewed_at, starts_at, ends_at, created_at`,
    "advertising-admin-policy-select"
  );

  const adminMapMarker = `        reviewStatus: row.review_status,\n        reviewedAt: row.reviewed_at,`;
  source = replaceExactlyOnce(
    source,
    adminMapMarker,
    `        reviewStatus: row.review_status,\n        reviewPolicyVersion: row.review_policy_version || null,\n        reviewAttestation: row.review_attestation || {},\n        reviewNotes: row.review_notes || null,\n        reviewedAt: row.reviewed_at,`,
    "advertising-admin-policy-map"
  );

  const reviewInputMarker = `  const action = String(req.body?.action || "").trim().toLowerCase();\n  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !["approve", "reject"].includes(action)) {\n    return res.status(400).json({ error: "Advertising review request is invalid." });\n  }`;
  source = replaceExactlyOnce(
    source,
    reviewInputMarker,
    `  const decision = normalizeAdvertisingReviewDecision(req.body);\n  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !decision) {\n    return res.status(400).json({ error: "Advertising review request is invalid." });\n  }\n  if (!decision.valid) {\n    return res.status(400).json({ error: decision.error || "Complete the advertising policy review before approval." });\n  }\n  const action = decision.action;`,
    "advertising-policy-review-input"
  );

  const approveMarker = `        \`UPDATE advertising_orders\n         SET review_status = 'approved',\n             reviewed_by_user_id = $1,\n             reviewed_at = NOW(),\n             starts_at = COALESCE(starts_at, NOW()),\n             ends_at = COALESCE(ends_at, NOW() + (duration_days * INTERVAL '1 day')),\n             updated_at = NOW()\n         WHERE id = $2\`,\n        [req.user.id, orderId]`;
  source = replaceExactlyOnce(
    source,
    approveMarker,
    `        \`UPDATE advertising_orders\n         SET review_status = 'approved',\n             reviewed_by_user_id = $1,\n             review_policy_version = $2,\n             review_attestation = $3::jsonb,\n             review_notes = $4,\n             reviewed_at = NOW(),\n             starts_at = COALESCE(starts_at, NOW()),\n             ends_at = COALESCE(ends_at, NOW() + (duration_days * INTERVAL '1 day')),\n             updated_at = NOW()\n         WHERE id = $5\`,\n        [req.user.id, decision.policyVersion, JSON.stringify(decision.checks), decision.notes, orderId]`,
    "advertising-policy-approve-persistence"
  );

  const rejectMarker = `        \`UPDATE advertising_orders\n         SET review_status = 'rejected',\n             reviewed_by_user_id = $1,\n             reviewed_at = NOW(),\n             starts_at = NULL,\n             ends_at = NULL,\n             updated_at = NOW()\n         WHERE id = $2\`,\n        [req.user.id, orderId]`;
  source = replaceExactlyOnce(
    source,
    rejectMarker,
    `        \`UPDATE advertising_orders\n         SET review_status = 'rejected',\n             reviewed_by_user_id = $1,\n             review_policy_version = $2,\n             review_attestation = $3::jsonb,\n             review_notes = $4,\n             reviewed_at = NOW(),\n             starts_at = NULL,\n             ends_at = NULL,\n             updated_at = NOW()\n         WHERE id = $5\`,\n        [req.user.id, decision.policyVersion, JSON.stringify(decision.checks), decision.notes, orderId]`,
    "advertising-policy-reject-persistence"
  );

  const responseMarker = `    return res.json({ ok: true, reviewStatus: action === "approve" ? "approved" : "rejected" });`;
  source = replaceExactlyOnce(
    source,
    responseMarker,
    `    return res.json({\n      ok: true,\n      reviewStatus: action === "approve" ? "approved" : "rejected",\n      policyVersion: decision.policyVersion\n    });`,
    "advertising-policy-review-response"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateAdvertisingPolicyServerSource
};
