const SAFE_ACTION = /^[a-z0-9_.:-]{1,120}$/i;

function normalizeAuditAction(value) {
  const action = String(value || "").trim();
  return SAFE_ACTION.test(action) ? action : "unknown";
}

function safeAuditDetails(value) {
  const input = value && typeof value === "object" ? value : {};
  const out = {};
  for (const [key, raw] of Object.entries(input)) {
    if (/token|secret|password|authorization|cookie|api.?key/i.test(key)) continue;
    if (raw === null || ["string", "number", "boolean"].includes(typeof raw)) {
      out[String(key).slice(0, 80)] = typeof raw === "string" ? raw.slice(0, 500) : raw;
    }
  }
  return out;
}

async function writeAuditEvent(pool, userId, action, details = {}) {
  if (!pool || !userId) return null;
  const result = await pool.query(
    `INSERT INTO platform_audit_events (user_id, action, details, created_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     RETURNING id, action, details, created_at`,
    [userId, normalizeAuditAction(action), JSON.stringify(safeAuditDetails(details))]
  );
  return result.rows[0] || null;
}

module.exports = {
  normalizeAuditAction,
  safeAuditDetails,
  writeAuditEvent
};
