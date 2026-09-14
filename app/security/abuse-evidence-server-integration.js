function integrateAbuseEvidenceServerSource(serverSource) {
  const source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "ABUSE_EVIDENCE_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  if (
    source.includes('"/api/admin/security/evidence/status"') &&
    source.includes("preserveHighRiskSafetyEvidence")
  ) {
    return source;
  }

  const marker = "/* ----------------------------- ADMIN API ----------------------------- */";
  const index = source.indexOf(marker);
  if (index === -1) {
    const error = new Error("UNBOUND AI admin API integration anchor is missing.");
    error.code = "ABUSE_EVIDENCE_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }

  const block = `const {\n  preserveAbuseEvidence,\n  listEvidenceMetadata,\n  readEvidencePayload,\n  setLegalHold,\n  releaseLegalHold,\n  purgeExpiredEvidence,\n  publicEvidenceStatus\n} = require("./security/abuse-evidence");\n\n// Internal-only preservation hook. Nothing calls this automatically merely because a\n// user chats or searches. A safety layer must first emit an explicit high-risk\n// enforcement event and supply only the evidence necessary for that event.\napp.locals.preserveHighRiskSafetyEvidence = async function preserveHighRiskSafetyEvidence(event = {}) {\n  return preserveAbuseEvidence({\n    pool,\n    ...event,\n    env: process.env\n  });\n};\n\napp.get(\n  "/api/admin/security/evidence/status",\n  requireDatabase,\n  requireAdmin,\n  async (req, res) => {\n    return res.json({ evidence: publicEvidenceStatus() });\n  }\n);\n\napp.get(\n  "/api/admin/security/evidence",\n  requireDatabase,\n  requireAdmin,\n  async (req, res) => {\n    try {\n      const records = await listEvidenceMetadata({\n        pool,\n        limit: req.query?.limit\n      });\n      return res.json({ records });\n    } catch (error) {\n      console.error("UNBOUND AI EVIDENCE METADATA ERROR:", error?.code || error?.message || "unknown");\n      return res.status(500).json({ error: "Could not load preserved-event metadata." });\n    }\n  }\n);\n\napp.post(\n  "/api/admin/security/evidence/:id/read",\n  requireDatabase,\n  requireAdmin,\n  securityActionRateLimit,\n  async (req, res) => {\n    const reason = String(req.body?.reason || "").trim();\n    if (!reason) {\n      return res.status(400).json({ error: "A documented access reason is required." });\n    }\n    try {\n      const evidence = await readEvidencePayload({\n        pool,\n        evidenceId: req.params.id,\n        actorUserId: req.user.id,\n        reason,\n        requestId: req.requestId,\n        env: process.env\n      });\n      if (!evidence) return res.status(404).json({ error: "Preserved event not found." });\n      res.setHeader("Cache-Control", "no-store");\n      return res.json({ evidence });\n    } catch (error) {\n      const code = String(error?.code || "");\n      const status = code === "ABUSE_EVIDENCE_NOT_CONFIGURED" ? 503 : 400;\n      return res.status(status).json({\n        error: code === "ABUSE_EVIDENCE_NOT_CONFIGURED"\n          ? "Evidence decryption is not configured."\n          : "Could not read that preserved event."\n      });\n    }\n  }\n);\n\napp.post(\n  "/api/admin/security/evidence/:id/legal-hold",\n  requireDatabase,\n  requireAdmin,\n  securityActionRateLimit,\n  async (req, res) => {\n    try {\n      const held = await setLegalHold({\n        pool,\n        evidenceId: req.params.id,\n        actorUserId: req.user.id,\n        reference: req.body?.reference,\n        reason: req.body?.reason,\n        requestId: req.requestId\n      });\n      if (!held) return res.status(404).json({ error: "Preserved event not found." });\n      return res.json({ ok: true, legalHold: true });\n    } catch (error) {\n      return res.status(400).json({ error: "A valid legal-hold reference and reason are required." });\n    }\n  }\n);\n\napp.post(\n  "/api/admin/security/evidence/:id/release-hold",\n  requireDatabase,\n  requireAdmin,\n  securityActionRateLimit,\n  async (req, res) => {\n    try {\n      const released = await releaseLegalHold({\n        pool,\n        evidenceId: req.params.id,\n        actorUserId: req.user.id,\n        reason: req.body?.reason,\n        requestId: req.requestId\n      });\n      if (!released) {\n        return res.status(404).json({ error: "No active legal hold was found for that event." });\n      }\n      return res.json({ ok: true, legalHold: false });\n    } catch (error) {\n      return res.status(400).json({ error: "A documented legal-hold release reason is required." });\n    }\n  }\n);\n\napp.post(\n  "/api/admin/security/evidence/purge-expired",\n  requireDatabase,\n  requireAdmin,\n  securityActionRateLimit,\n  async (req, res) => {\n    try {\n      const result = await purgeExpiredEvidence({ pool });\n      return res.json({ ok: true, ...result });\n    } catch (error) {\n      console.error("UNBOUND AI EVIDENCE PURGE ERROR:", error?.code || error?.message || "unknown");\n      return res.status(500).json({ error: "Could not purge expired preserved events." });\n    }\n  }\n);\n\n`;

  return source.slice(0, index) + block + source.slice(index);
}

module.exports = {
  integrateAbuseEvidenceServerSource
};
