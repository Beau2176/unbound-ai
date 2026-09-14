const crypto = require("crypto");
const {
  ensureAbuseEvidenceSchema,
  readEvidencePayload,
  setLegalHold,
  auditEvidenceAccess
} = require("./abuse-evidence");

const DEFAULT_SEARCH_WINDOW_MINUTES = 180;
const MIN_SEARCH_WINDOW_MINUTES = 15;
const MAX_SEARCH_WINDOW_MINUTES = 1440;
const MAX_TEXT = 300;
const MAX_EXPORT_RECORDS = 100;

function cleanText(value, maxLength = MAX_TEXT) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function normalizeSearchWindowMinutes(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SEARCH_WINDOW_MINUTES;
  return Math.min(Math.max(parsed, MIN_SEARCH_WINDOW_MINUTES), MAX_SEARCH_WINDOW_MINUTES);
}

function normalizeApproximateOccurredAt(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function maskEmail(value) {
  const email = String(value || "");
  const at = email.indexOf("@");
  if (at <= 1) return "hidden";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function ensureLawEnforcementSchema(pool) {
  if (!pool || typeof pool.query !== "function") return false;
  await ensureAbuseEvidenceSchema(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS law_enforcement_requests (
      id UUID PRIMARY KEY,
      agency_name TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      request_reference TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      approximate_occurred_at TIMESTAMPTZ NOT NULL,
      search_window_minutes INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      exported_at TIMESTAMPTZ,
      exported_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      export_sha256 CHAR(64),
      CONSTRAINT law_enforcement_request_status_check
        CHECK (status IN ('open','exported','closed')),
      CONSTRAINT law_enforcement_search_window_check
        CHECK (search_window_minutes BETWEEN 15 AND 1440)
    );

    CREATE INDEX IF NOT EXISTS law_enforcement_request_created_idx
      ON law_enforcement_requests(created_at DESC);
    CREATE INDEX IF NOT EXISTS law_enforcement_request_subject_time_idx
      ON law_enforcement_requests(LOWER(subject_name), approximate_occurred_at DESC);
  `);
  return true;
}

async function createLawEnforcementRequest({
  pool,
  agencyName,
  requesterName,
  requestReference,
  subjectName,
  approximateOccurredAt,
  searchWindowMinutes = DEFAULT_SEARCH_WINDOW_MINUTES,
  actorUserId = null
} = {}) {
  const agency = cleanText(agencyName);
  const requester = cleanText(requesterName);
  const reference = cleanText(requestReference);
  const subject = cleanText(subjectName);
  const occurred = normalizeApproximateOccurredAt(approximateOccurredAt);
  const windowMinutes = normalizeSearchWindowMinutes(searchWindowMinutes);

  if (!agency || !requester || !reference || !subject || !occurred) {
    const error = new Error("A specific law-enforcement request, subject name, and approximate date/time are required.");
    error.code = "LAW_ENFORCEMENT_REQUEST_INVALID";
    throw error;
  }

  await ensureLawEnforcementSchema(pool);
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO law_enforcement_requests (
       id, agency_name, requester_name, request_reference, subject_name,
       approximate_occurred_at, search_window_minutes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      agency,
      requester,
      reference,
      subject,
      occurred.toISOString(),
      windowMinutes,
      actorUserId || null
    ]
  );

  return {
    id,
    agencyName: agency,
    requesterName: requester,
    requestReference: reference,
    subjectName: subject,
    approximateOccurredAt: occurred.toISOString(),
    searchWindowMinutes: windowMinutes,
    status: "open"
  };
}

async function listLawEnforcementRequests({ pool, limit = 50 } = {}) {
  await ensureLawEnforcementSchema(pool);
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limit || 50), 10) || 50, 1), 200);
  const result = await pool.query(
    `SELECT id, agency_name, requester_name, request_reference, subject_name,
            approximate_occurred_at, search_window_minutes, status,
            created_at, exported_at, export_sha256
       FROM law_enforcement_requests
      ORDER BY created_at DESC
      LIMIT $1`,
    [safeLimit]
  );
  return result.rows;
}

async function getLawEnforcementRequest(pool, requestId) {
  const id = cleanText(requestId, 80);
  if (!id) return null;
  await ensureLawEnforcementSchema(pool);
  const result = await pool.query(
    `SELECT * FROM law_enforcement_requests WHERE id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
}

function requestTimeBounds(request) {
  const center = new Date(request.approximate_occurred_at);
  const windowMinutes = normalizeSearchWindowMinutes(request.search_window_minutes);
  const delta = windowMinutes * 60_000;
  return {
    start: new Date(center.getTime() - delta),
    end: new Date(center.getTime() + delta)
  };
}

async function searchEvidenceForLawEnforcementRequest({ pool, requestId } = {}) {
  const request = await getLawEnforcementRequest(pool, requestId);
  if (!request) return null;
  const bounds = requestTimeBounds(request);
  const result = await pool.query(
    `SELECT e.id, e.user_id, u.display_name, u.email,
            e.category, e.enforcement_source, e.preservation_reason,
            e.confidence, e.payload_sha256, e.payload_bytes,
            e.occurred_at, e.preserved_at, e.retention_expires_at,
            e.legal_hold, e.legal_hold_reference
       FROM abuse_evidence_records e
       JOIN users u ON u.id = e.user_id
      WHERE LOWER(TRIM(u.display_name)) = LOWER(TRIM($1))
        AND e.occurred_at BETWEEN $2 AND $3
      ORDER BY e.occurred_at ASC
      LIMIT 500`,
    [request.subject_name, bounds.start.toISOString(), bounds.end.toISOString()]
  );

  return {
    request: {
      id: request.id,
      agencyName: request.agency_name,
      requesterName: request.requester_name,
      requestReference: request.request_reference,
      subjectName: request.subject_name,
      approximateOccurredAt: request.approximate_occurred_at,
      searchWindowMinutes: request.search_window_minutes,
      status: request.status
    },
    searchBounds: {
      start: bounds.start.toISOString(),
      end: bounds.end.toISOString()
    },
    records: result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name,
      maskedEmail: maskEmail(row.email),
      category: row.category,
      enforcementSource: row.enforcement_source,
      preservationReason: row.preservation_reason,
      confidence: row.confidence,
      payloadSha256: row.payload_sha256,
      payloadBytes: row.payload_bytes,
      occurredAt: row.occurred_at,
      preservedAt: row.preserved_at,
      retentionExpiresAt: row.retention_expires_at,
      legalHold: Boolean(row.legal_hold),
      legalHoldReference: row.legal_hold_reference || null
    }))
  };
}

async function buildLawEnforcementExport({
  pool,
  requestId,
  evidenceIds,
  actorUserId,
  reviewReason,
  auditRequestId,
  env = process.env
} = {}) {
  const request = await getLawEnforcementRequest(pool, requestId);
  if (!request) return null;
  const reason = cleanText(reviewReason, 2000);
  if (!reason) {
    const error = new Error("A documented disclosure-review reason is required.");
    error.code = "LAW_ENFORCEMENT_EXPORT_REASON_REQUIRED";
    throw error;
  }

  const ids = Array.from(new Set(Array.isArray(evidenceIds) ? evidenceIds.map((id) => cleanText(id, 80)).filter(Boolean) : []));
  if (!ids.length || ids.length > MAX_EXPORT_RECORDS) {
    const error = new Error("Select between 1 and 100 preserved records for export.");
    error.code = "LAW_ENFORCEMENT_EXPORT_SELECTION_INVALID";
    throw error;
  }

  const bounds = requestTimeBounds(request);
  const eligible = await pool.query(
    `SELECT e.id
       FROM abuse_evidence_records e
       JOIN users u ON u.id = e.user_id
      WHERE e.id = ANY($1::uuid[])
        AND LOWER(TRIM(u.display_name)) = LOWER(TRIM($2))
        AND e.occurred_at BETWEEN $3 AND $4`,
    [ids, request.subject_name, bounds.start.toISOString(), bounds.end.toISOString()]
  );
  const eligibleIds = new Set(eligible.rows.map((row) => String(row.id)));
  if (eligibleIds.size !== ids.length || ids.some((id) => !eligibleIds.has(id))) {
    const error = new Error("One or more selected records do not match this request's subject and time window.");
    error.code = "LAW_ENFORCEMENT_EXPORT_SCOPE_MISMATCH";
    throw error;
  }

  const records = [];
  for (const evidenceId of ids) {
    const holdReason = `Law-enforcement request ${request.request_reference}: ${reason}`;
    await setLegalHold({
      pool,
      evidenceId,
      actorUserId,
      reference: request.request_reference,
      reason: holdReason,
      requestId: auditRequestId
    });
    const evidence = await readEvidencePayload({
      pool,
      evidenceId,
      actorUserId,
      reason: holdReason,
      requestId: auditRequestId,
      env
    });
    if (!evidence) continue;
    await auditEvidenceAccess({
      pool,
      evidenceId,
      actorUserId,
      action: "law_enforcement_export",
      reason: holdReason,
      requestId: auditRequestId
    });
    records.push(evidence);
  }

  const generatedAt = new Date().toISOString();
  const packageWithoutHash = {
    exportVersion: 1,
    generatedAt,
    disclosurePolicy: {
      automaticDisclosure: false,
      purpose: "Manual response to a specific law-enforcement request",
      legalDeterminationByVault: false
    },
    request: {
      id: request.id,
      agencyName: request.agency_name,
      requesterName: request.requester_name,
      requestReference: request.request_reference,
      subjectName: request.subject_name,
      approximateOccurredAt: request.approximate_occurred_at,
      searchWindowMinutes: request.search_window_minutes
    },
    records
  };
  const canonical = JSON.stringify(packageWithoutHash);
  const exportSha256 = sha256(Buffer.from(canonical, "utf8"));
  const evidencePackage = {
    ...packageWithoutHash,
    integrity: {
      algorithm: "SHA-256",
      exportSha256
    }
  };

  await pool.query(
    `UPDATE law_enforcement_requests
        SET status = 'exported', exported_at = NOW(), exported_by = $2, export_sha256 = $3
      WHERE id = $1`,
    [request.id, actorUserId || null, exportSha256]
  );

  return {
    requestReference: request.request_reference,
    exportSha256,
    evidencePackage
  };
}

function safeExportFilename(reference) {
  const token = String(reference || "request")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "request";
  return `unbound-law-enforcement-${token}.json`;
}

module.exports = {
  DEFAULT_SEARCH_WINDOW_MINUTES,
  MIN_SEARCH_WINDOW_MINUTES,
  MAX_SEARCH_WINDOW_MINUTES,
  MAX_EXPORT_RECORDS,
  normalizeSearchWindowMinutes,
  normalizeApproximateOccurredAt,
  ensureLawEnforcementSchema,
  createLawEnforcementRequest,
  listLawEnforcementRequests,
  searchEvidenceForLawEnforcementRequest,
  buildLawEnforcementExport,
  safeExportFilename
};
