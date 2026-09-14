const crypto = require("crypto");

const EVIDENCE_CATEGORIES = Object.freeze([
  "minor_sexual_exploitation",
  "credible_violent_threat",
  "human_trafficking_exploitation",
  "serious_cyber_abuse",
  "other_preservation_eligible"
]);

const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 3650;
const MAX_REASON_CHARS = 2000;
const MAX_SOURCE_CHARS = 120;
const MAX_REFERENCE_CHARS = 300;
const MAX_PAYLOAD_BYTES = 256 * 1024;

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeEvidenceCategory(value) {
  const category = String(value || "").trim().toLowerCase();
  return EVIDENCE_CATEGORIES.includes(category) ? category : null;
}

function cleanText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function parseEvidenceKey(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  let key;
  if (/^[A-Fa-f0-9]{64}$/.test(text)) {
    key = Buffer.from(text, "hex");
  } else {
    try { key = Buffer.from(text, "base64"); } catch (_) { return null; }
  }
  return key.length === 32 ? key : null;
}

function getEvidenceConfig(env = process.env) {
  const key = parseEvidenceKey(env.ABUSE_EVIDENCE_ENCRYPTION_KEY);
  const retentionDays = boundedInteger(
    env.ABUSE_EVIDENCE_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
    1,
    MAX_RETENTION_DAYS
  );
  const enabled = truthy(env.ABUSE_EVIDENCE_PRESERVATION_ENABLED);
  return {
    enabled,
    configured: Boolean(enabled && key),
    key,
    retentionDays,
    maxPayloadBytes: MAX_PAYLOAD_BYTES,
    automaticDisclosure: false,
    blanketConversationRecording: false
  };
}

function canonicalEvidencePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("Evidence payload must be an object.");
    error.code = "ABUSE_EVIDENCE_PAYLOAD_INVALID";
    throw error;
  }
  const json = JSON.stringify(value);
  const bytes = Buffer.byteLength(json, "utf8");
  if (!bytes || bytes > MAX_PAYLOAD_BYTES) {
    const error = new Error("Evidence payload exceeds the preservation limit.");
    error.code = "ABUSE_EVIDENCE_PAYLOAD_TOO_LARGE";
    throw error;
  }
  return { json, bytes };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encryptEvidencePayload(payload, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    const error = new Error("Evidence encryption key is not configured.");
    error.code = "ABUSE_EVIDENCE_KEY_INVALID";
    throw error;
  }
  const canonical = canonicalEvidencePayload(payload);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(canonical.json, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return {
    payloadSha256: sha256(Buffer.from(canonical.json, "utf8")),
    encryptedPayload: ciphertext.toString("base64"),
    encryptionIv: iv.toString("base64"),
    encryptionTag: tag.toString("base64"),
    payloadBytes: canonical.bytes
  };
}

function decryptEvidencePayload(record, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    const error = new Error("Evidence encryption key is not configured.");
    error.code = "ABUSE_EVIDENCE_KEY_INVALID";
    throw error;
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(String(record.encryption_iv || record.encryptionIv), "base64")
  );
  decipher.setAuthTag(
    Buffer.from(String(record.encryption_tag || record.encryptionTag), "base64")
  );
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(String(record.encrypted_payload || record.encryptedPayload), "base64")),
    decipher.final()
  ]).toString("utf8");
  if (sha256(Buffer.from(plaintext, "utf8")) !== String(record.payload_sha256 || record.payloadSha256)) {
    const error = new Error("Evidence integrity verification failed.");
    error.code = "ABUSE_EVIDENCE_INTEGRITY_FAILED";
    throw error;
  }
  return JSON.parse(plaintext);
}

async function ensureAbuseEvidenceSchema(pool) {
  if (!pool || typeof pool.query !== "function") return false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS abuse_evidence_records (
      id UUID PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      request_id TEXT,
      category TEXT NOT NULL,
      enforcement_source TEXT NOT NULL,
      preservation_reason TEXT NOT NULL,
      confidence NUMERIC(5,4),
      payload_sha256 CHAR(64) NOT NULL,
      encrypted_payload TEXT NOT NULL,
      encryption_iv TEXT NOT NULL,
      encryption_tag TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      preserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      retention_expires_at TIMESTAMPTZ NOT NULL,
      legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
      legal_hold_reference TEXT,
      legal_hold_reason TEXT,
      legal_hold_set_at TIMESTAMPTZ,
      legal_hold_set_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      released_at TIMESTAMPTZ,
      released_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      release_reason TEXT,
      CONSTRAINT abuse_evidence_category_check CHECK (
        category IN (
          'minor_sexual_exploitation',
          'credible_violent_threat',
          'human_trafficking_exploitation',
          'serious_cyber_abuse',
          'other_preservation_eligible'
        )
      )
    );

    CREATE INDEX IF NOT EXISTS abuse_evidence_retention_idx
      ON abuse_evidence_records(legal_hold, retention_expires_at);
    CREATE INDEX IF NOT EXISTS abuse_evidence_user_idx
      ON abuse_evidence_records(user_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS abuse_evidence_access_audit (
      id BIGSERIAL PRIMARY KEY,
      evidence_id UUID REFERENCES abuse_evidence_records(id) ON DELETE CASCADE,
      actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      request_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS abuse_evidence_access_audit_idx
      ON abuse_evidence_access_audit(evidence_id, created_at DESC);
  `);
  return true;
}

async function preserveAbuseEvidence({
  pool,
  userId = null,
  requestId = null,
  category,
  enforcementSource,
  preservationReason,
  confidence = null,
  payload,
  occurredAt = new Date(),
  env = process.env
} = {}) {
  const config = getEvidenceConfig(env);
  if (!config.configured) {
    return { preserved: false, state: config.enabled ? "key-not-configured" : "disabled" };
  }
  const normalizedCategory = normalizeEvidenceCategory(category);
  const source = cleanText(enforcementSource, MAX_SOURCE_CHARS);
  const reason = cleanText(preservationReason, MAX_REASON_CHARS);
  const occurred = new Date(occurredAt);
  const confidenceNumber = confidence === null || confidence === undefined
    ? null
    : Number(confidence);
  if (
    !normalizedCategory ||
    !source ||
    !reason ||
    !Number.isFinite(occurred.getTime()) ||
    (confidenceNumber !== null && (!Number.isFinite(confidenceNumber) || confidenceNumber < 0 || confidenceNumber > 1))
  ) {
    const error = new Error("Evidence preservation request is invalid.");
    error.code = "ABUSE_EVIDENCE_INPUT_INVALID";
    throw error;
  }

  await ensureAbuseEvidenceSchema(pool);
  const encrypted = encryptEvidencePayload(payload, config.key);
  const id = crypto.randomUUID();
  const expiresAt = new Date(
    Math.max(Date.now(), occurred.getTime()) + config.retentionDays * 86_400_000
  ).toISOString();

  await pool.query(
    `INSERT INTO abuse_evidence_records (
       id, user_id, request_id, category, enforcement_source,
       preservation_reason, confidence, payload_sha256, encrypted_payload,
       encryption_iv, encryption_tag, payload_bytes, occurred_at,
       retention_expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      userId || null,
      cleanText(requestId, MAX_REFERENCE_CHARS),
      normalizedCategory,
      source,
      reason,
      confidenceNumber,
      encrypted.payloadSha256,
      encrypted.encryptedPayload,
      encrypted.encryptionIv,
      encrypted.encryptionTag,
      encrypted.payloadBytes,
      occurred.toISOString(),
      expiresAt
    ]
  );

  return {
    preserved: true,
    id,
    category: normalizedCategory,
    payloadSha256: encrypted.payloadSha256,
    payloadBytes: encrypted.payloadBytes,
    occurredAt: occurred.toISOString(),
    retentionExpiresAt: expiresAt,
    legalHold: false,
    automaticDisclosure: false
  };
}

async function listEvidenceMetadata({ pool, limit = 100 } = {}) {
  await ensureAbuseEvidenceSchema(pool);
  const safeLimit = boundedInteger(limit, 100, 1, 500);
  const result = await pool.query(
    `SELECT id, user_id, request_id, category, enforcement_source,
            preservation_reason, confidence, payload_sha256, payload_bytes,
            occurred_at, preserved_at, retention_expires_at, legal_hold,
            legal_hold_reference, legal_hold_reason, legal_hold_set_at,
            released_at, release_reason
       FROM abuse_evidence_records
      ORDER BY occurred_at DESC
      LIMIT $1`,
    [safeLimit]
  );
  return result.rows;
}

async function auditEvidenceAccess({
  pool,
  evidenceId,
  actorUserId = null,
  action,
  reason,
  requestId = null
} = {}) {
  const normalizedAction = cleanText(action, 80);
  const normalizedReason = cleanText(reason, MAX_REASON_CHARS);
  if (!normalizedAction || !normalizedReason) {
    const error = new Error("Evidence access audit reason is required.");
    error.code = "ABUSE_EVIDENCE_AUDIT_INVALID";
    throw error;
  }
  await ensureAbuseEvidenceSchema(pool);
  await pool.query(
    `INSERT INTO abuse_evidence_access_audit
       (evidence_id, actor_user_id, action, reason, request_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      evidenceId,
      actorUserId || null,
      normalizedAction,
      normalizedReason,
      cleanText(requestId, MAX_REFERENCE_CHARS)
    ]
  );
}

async function readEvidencePayload({ pool, evidenceId, actorUserId, reason, requestId, env = process.env } = {}) {
  const config = getEvidenceConfig(env);
  if (!config.configured) {
    const error = new Error("Evidence preservation is not configured.");
    error.code = "ABUSE_EVIDENCE_NOT_CONFIGURED";
    throw error;
  }
  const id = cleanText(evidenceId, 80);
  if (!id) throw Object.assign(new Error("Evidence ID is invalid."), { code: "ABUSE_EVIDENCE_ID_INVALID" });
  await ensureAbuseEvidenceSchema(pool);
  const result = await pool.query(
    `SELECT * FROM abuse_evidence_records WHERE id = $1 LIMIT 1`,
    [id]
  );
  const record = result.rows[0];
  if (!record) return null;
  await auditEvidenceAccess({
    pool,
    evidenceId: id,
    actorUserId,
    action: "decrypt",
    reason,
    requestId
  });
  return {
    metadata: {
      id: record.id,
      userId: record.user_id,
      category: record.category,
      enforcementSource: record.enforcement_source,
      preservationReason: record.preservation_reason,
      confidence: record.confidence,
      payloadSha256: record.payload_sha256,
      occurredAt: record.occurred_at,
      preservedAt: record.preserved_at,
      retentionExpiresAt: record.retention_expires_at,
      legalHold: Boolean(record.legal_hold)
    },
    payload: decryptEvidencePayload(record, config.key)
  };
}

async function setLegalHold({
  pool,
  evidenceId,
  actorUserId,
  reference,
  reason,
  requestId
} = {}) {
  const ref = cleanText(reference, MAX_REFERENCE_CHARS);
  const holdReason = cleanText(reason, MAX_REASON_CHARS);
  if (!ref || !holdReason) {
    const error = new Error("A legal-hold reference and reason are required.");
    error.code = "ABUSE_EVIDENCE_LEGAL_HOLD_INVALID";
    throw error;
  }
  await ensureAbuseEvidenceSchema(pool);
  const result = await pool.query(
    `UPDATE abuse_evidence_records
        SET legal_hold = TRUE,
            legal_hold_reference = $2,
            legal_hold_reason = $3,
            legal_hold_set_at = NOW(),
            legal_hold_set_by = $4,
            released_at = NULL,
            released_by = NULL,
            release_reason = NULL
      WHERE id = $1
      RETURNING id`,
    [evidenceId, ref, holdReason, actorUserId || null]
  );
  if (!result.rowCount) return false;
  await auditEvidenceAccess({
    pool,
    evidenceId,
    actorUserId,
    action: "legal_hold_set",
    reason: `${ref}: ${holdReason}`,
    requestId
  });
  return true;
}

async function releaseLegalHold({
  pool,
  evidenceId,
  actorUserId,
  reason,
  requestId
} = {}) {
  const releaseReason = cleanText(reason, MAX_REASON_CHARS);
  if (!releaseReason) {
    const error = new Error("A legal-hold release reason is required.");
    error.code = "ABUSE_EVIDENCE_LEGAL_HOLD_RELEASE_INVALID";
    throw error;
  }
  await ensureAbuseEvidenceSchema(pool);
  const result = await pool.query(
    `UPDATE abuse_evidence_records
        SET legal_hold = FALSE,
            released_at = NOW(),
            released_by = $2,
            release_reason = $3
      WHERE id = $1 AND legal_hold = TRUE
      RETURNING id`,
    [evidenceId, actorUserId || null, releaseReason]
  );
  if (!result.rowCount) return false;
  await auditEvidenceAccess({
    pool,
    evidenceId,
    actorUserId,
    action: "legal_hold_released",
    reason: releaseReason,
    requestId
  });
  return true;
}

async function purgeExpiredEvidence({ pool, now = new Date() } = {}) {
  await ensureAbuseEvidenceSchema(pool);
  const timestamp = new Date(now);
  if (!Number.isFinite(timestamp.getTime())) {
    throw Object.assign(new Error("Purge timestamp is invalid."), { code: "ABUSE_EVIDENCE_PURGE_TIME_INVALID" });
  }
  const result = await pool.query(
    `DELETE FROM abuse_evidence_records
      WHERE legal_hold = FALSE
        AND retention_expires_at <= $1`,
    [timestamp.toISOString()]
  );
  return { deleted: Number(result.rowCount || 0) };
}

function publicEvidenceStatus(env = process.env) {
  const config = getEvidenceConfig(env);
  return {
    enabled: config.enabled,
    configured: config.configured,
    retentionDays: config.retentionDays,
    encryption: "AES-256-GCM",
    integrityHash: "SHA-256",
    automaticDisclosure: false,
    blanketConversationRecording: false,
    ingestionBoundary: "explicit-high-risk-safety-enforcement-event"
  };
}

module.exports = {
  EVIDENCE_CATEGORIES,
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MAX_PAYLOAD_BYTES,
  normalizeEvidenceCategory,
  parseEvidenceKey,
  getEvidenceConfig,
  canonicalEvidencePayload,
  encryptEvidencePayload,
  decryptEvidencePayload,
  ensureAbuseEvidenceSchema,
  preserveAbuseEvidence,
  listEvidenceMetadata,
  auditEvidenceAccess,
  readEvidencePayload,
  setLegalHold,
  releaseLegalHold,
  purgeExpiredEvidence,
  publicEvidenceStatus
};
