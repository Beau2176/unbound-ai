const express = require("express");
const path = require("path");
const { generateChat, getGatewayStatus } = require("../ai/gateway");
const {
  runWithRequestCancellation,
  handleCancelledJsonResponse
} = require("../ops/request-cancellation");
const {
  ARTIFACT_TYPES,
  normalizePlanRequest,
  normalizeArtifactSpec,
  extractJsonObject,
  buildPlannerInstructions
} = require("./schema");
const { generateArtifact } = require("./generator");

const ARTIFACT_JSON_LIMIT = "512kb";
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;

function safeArtifactError(error) {
  const code = String(error?.code || "");
  if (code === "USAGE_MONTHLY_LIMIT_REACHED") {
    return { statusCode: Number(error?.statusCode) || 429, code, message: error?.publicMessage || error?.message || "Monthly usage allowance reached." };
  }
  if (code === "AI_PROVIDER_NOT_CONFIGURED") {
    return { statusCode: 503, code, message: "Artifact planning is temporarily unavailable because the AI provider is not configured." };
  }
  if (code.startsWith("ARTIFACT_")) {
    return {
      statusCode: Number(error?.statusCode) || 400,
      code,
      message: String(error?.message || "The artifact request is invalid.").slice(0, 500)
    };
  }
  return {
    statusCode: 502,
    code: "ARTIFACT_OPERATION_FAILED",
    message: "UNBOUND could not complete that artifact operation."
  };
}

function artifactStatus() {
  const ai = getGatewayStatus();
  return {
    configured: true,
    plannerConfigured: Boolean(ai.configured),
    plannerProvider: ai.provider || null,
    plannerModel: ai.model || null,
    types: ARTIFACT_TYPES,
    exports: {
      document: "docx",
      spreadsheet: "xlsx",
      presentation: "pptx"
    },
    limits: {
      requestBody: ARTIFACT_JSON_LIMIT,
      maxExportBytes: MAX_EXPORT_BYTES
    },
    privacy: {
      generatedBinaryStoredByUnbound: false,
      macrosOrExecutableContent: false
    }
  };
}

function buildPlannerInput(request) {
  return [
    request.title ? `Requested title: ${request.title}` : "",
    "User request:",
    request.prompt
  ].filter(Boolean).join("\n\n");
}

function createArtifactRouter({
  recordUsageEvent = null,
  estimateProviderCostMicros = null
} = {}) {
  const router = express.Router();
  router.use(express.json({ limit: ARTIFACT_JSON_LIMIT, type: "application/json" }));

  router.get("/status", (req, res) => {
    return res.json(artifactStatus());
  });

  router.post("/plan", async (req, res) => {
    try {
      if (typeof assertUsageBudget === "function") {
        await assertUsageBudget({ userId: req.user?.id || null, category: "artifact" });
      }
      const request = normalizePlanRequest(req.body);
      const ai = getGatewayStatus();
      if (!ai.configured) {
        return res.status(503).json({
          error: "Artifact planning is temporarily unavailable.",
          code: "AI_PROVIDER_NOT_CONFIGURED"
        });
      }

      const result = await runWithRequestCancellation(
        req,
        res,
        (signal) => generateChat({
          instructions: buildPlannerInstructions(request.type),
          input: buildPlannerInput(request),
          reasoningEffort: "low",
          signal
        })
      );
      const parsed = extractJsonObject(result.reply || "");
      if (request.title && !parsed.title) parsed.title = request.title;
      const spec = normalizeArtifactSpec(parsed, request.type);

      if (typeof recordUsageEvent === "function") {
        const estimatedCostMicros = typeof estimateProviderCostMicros === "function"
          ? estimateProviderCostMicros(result.provider, result.usage)
          : null;
        try {
          await recordUsageEvent({
            userId: req.user?.id || null,
            provider: result.provider,
            model: result.model,
            eventType: "artifact_plan",
            usage: result.usage,
            webSearchCalls: 0,
            estimatedCostMicros,
            providerResponseId: result.responseId
          });
        } catch (usageError) {
          console.error("UNBOUND AI ARTIFACT USAGE RECORD ERROR:", usageError?.code || usageError?.message || "unknown");
        }
      }

      return res.json({
        ok: true,
        type: request.type,
        spec,
        provider: result.provider || ai.provider || null,
        model: result.model || ai.model || null,
        usage: result.usage ? {
          inputTokens: Number(result.usage.input_tokens || 0),
          outputTokens: Number(result.usage.output_tokens || 0),
          totalTokens: Number(result.usage.total_tokens || 0)
        } : null
      });
    } catch (error) {
      if (handleCancelledJsonResponse(res, error)) return;
      const safe = safeArtifactError(error);
      if (safe.code === "ARTIFACT_OPERATION_FAILED") {
        console.error("UNBOUND AI ARTIFACT PLAN ERROR:", error?.code || error?.message || "unknown");
      }
      return res.status(safe.statusCode).json({ error: safe.message, code: safe.code });
    }
  });

  router.post("/export", async (req, res) => {
    try {
      const spec = normalizeArtifactSpec(req.body?.spec || req.body, req.body?.type || null);
      const artifact = await generateArtifact(spec);
      if (!Buffer.isBuffer(artifact.buffer) || artifact.buffer.length < 1) {
        const error = new Error("Artifact export produced no file data.");
        error.code = "ARTIFACT_EXPORT_EMPTY";
        throw error;
      }
      if (artifact.buffer.length > MAX_EXPORT_BYTES) {
        const error = new Error("Artifact export exceeded the maximum file size.");
        error.code = "ARTIFACT_EXPORT_TOO_LARGE";
        error.statusCode = 413;
        throw error;
      }
      res.setHeader("Content-Type", artifact.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${artifact.filename}"`);
      res.setHeader("Content-Length", String(artifact.buffer.length));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(artifact.buffer);
    } catch (error) {
      const safe = safeArtifactError(error);
      if (safe.code === "ARTIFACT_OPERATION_FAILED") {
        console.error("UNBOUND AI ARTIFACT EXPORT ERROR:", error?.code || error?.message || "unknown");
      }
      return res.status(safe.statusCode).json({ error: safe.message, code: safe.code });
    }
  });

  router.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({
        error: "The artifact request is too large.",
        code: "ARTIFACT_REQUEST_TOO_LARGE"
      });
    }
    if (error instanceof SyntaxError) {
      return res.status(400).json({
        error: "The artifact request is invalid JSON.",
        code: "ARTIFACT_REQUEST_INVALID"
      });
    }
    return next(error);
  });

  return router;
}

function sendArtifactStudioPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "artifact-studio.html"));
}

module.exports = {
  ARTIFACT_JSON_LIMIT,
  MAX_EXPORT_BYTES,
  safeArtifactError,
  artifactStatus,
  buildPlannerInput,
  createArtifactRouter,
  sendArtifactStudioPage
};
