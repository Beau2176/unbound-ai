const express = require("express");
const path = require("path");
const { analyzeImage, getImageGatewayStatus } = require("./gateway");
const {
  scanBufferForMalware,
  publicMalwareScanStatus
} = require("../security/malware-scan");
const {
  getImageUnderstandingConfig,
  normalizeImageUnderstandingRequest,
  publicImageUnderstandingConfig
} = require("./analysis");

function safeImageError(error) {
  const code = String(error?.code || "");
  if (code === "USAGE_MONTHLY_LIMIT_REACHED") {
    return { statusCode: Number(error?.statusCode) || 429, code, message: error?.publicMessage || error?.message || "Monthly usage allowance reached." };
  }
  if (code === "IMAGE_PROVIDER_NOT_CONFIGURED") {
    return {
      statusCode: 503,
      code,
      message: "Image understanding is temporarily unavailable because the AI provider is not configured."
    };
  }
  if (code === "IMAGE_PROVIDER_UNSUPPORTED") {
    return {
      statusCode: 503,
      code,
      message: "The configured AI provider does not support image understanding."
    };
  }
  if (code === "UPLOAD_MALWARE_DETECTED") {
    return { statusCode: 400, code, message: "That upload was blocked because malware was detected." };
  }
  if (code === "UPLOAD_MALWARE_SCANNER_UNAVAILABLE") {
    return { statusCode: 503, code, message: "Upload malware scanning is temporarily unavailable. Try again shortly." };
  }
  if (code === "UPLOAD_MALWARE_SCAN_INPUT_INVALID") {
    return { statusCode: 400, code, message: "The upload could not be scanned safely." };
  }
  if (code.startsWith("IMAGE_UNDERSTANDING_")) {
    return {
      statusCode: Number(error?.statusCode) || 400,
      code,
      message: error?.publicMessage || "The image could not be analyzed."
    };
  }
  return {
    statusCode: 502,
    code: "IMAGE_UNDERSTANDING_PROVIDER_FAILED",
    message: "The AI provider could not analyze that image. Try again shortly."
  };
}

function logImageMalwareScan(result) {
  if (!result || result.state !== "unavailable") return;
  console.warn(
    "UNBOUND AI IMAGE UNDERSTANDING MALWARE SCAN DEGRADED:",
    result.internalReason || "scanner-unavailable",
    result.sha256 ? `sha256=${result.sha256.slice(0, 16)}` : ""
  );
}

function createImageUnderstandingRouter({
  recordUsageEvent = null,
  estimateProviderCostMicros = null,
  env = process.env
} = {}) {
  const router = express.Router();
  const config = getImageUnderstandingConfig(env);

  router.use(express.json({ limit: config.jsonBodyLimit, type: "application/json" }));

  router.get("/status", (req, res) => {
    const ai = getImageGatewayStatus(env);
    return res.json({
      configured: Boolean(ai.configured && ai.imageUnderstanding),
      provider: ai.provider || null,
      model: ai.model || null,
      limits: publicImageUnderstandingConfig(env),
      malwareScan: publicMalwareScanStatus(env)
    });
  });

  router.post("/", async (req, res) => {
    try {
      const ai = getImageGatewayStatus(env);
      if (!ai.configured || !ai.imageUnderstanding) {
        return res.status(503).json({
          error: "Image understanding is temporarily unavailable.",
          code: ai.configured ? "IMAGE_PROVIDER_UNSUPPORTED" : "IMAGE_PROVIDER_NOT_CONFIGURED"
        });
      }

      if (typeof assertUsageBudget === "function") {
        await assertUsageBudget({ userId: req.user?.id || null, category: "image_understanding" });
      }

      const input = normalizeImageUnderstandingRequest(req.body, env);
      const malwareScan = await scanBufferForMalware({
        filename: input.filename,
        buffer: Buffer.from(input.imageBase64, "base64"),
        env
      });
      logImageMalwareScan(malwareScan);
      const result = await analyzeImage({
        mimeType: input.mimeType,
        imageBase64: input.imageBase64,
        prompt: input.prompt,
        detail: input.detail,
        env
      });

      if (typeof recordUsageEvent === "function") {
        const estimatedCostMicros =
          typeof estimateProviderCostMicros === "function"
            ? estimateProviderCostMicros(result.provider, result.usage)
            : null;
        try {
          await recordUsageEvent({
            userId: req.user?.id || null,
            provider: result.provider,
            model: result.model,
            eventType: "image_understanding",
            usage: result.usage,
            webSearchCalls: 0,
            estimatedCostMicros,
            providerResponseId: result.responseId
          });
        } catch (usageError) {
          console.error(
            "UNBOUND AI IMAGE UNDERSTANDING USAGE RECORD ERROR:",
            usageError?.code || usageError?.message || "unknown"
          );
        }
      }

      return res.json({
        ok: true,
        analysis: result.reply || "",
        image: {
          name: input.filename,
          bytes: input.imageBytes,
          type: input.mimeType,
          detail: input.detail
        },
        provider: result.provider,
        model: result.model,
        usage: result.usage
          ? {
              inputTokens: Number(result.usage.input_tokens || 0),
              outputTokens: Number(result.usage.output_tokens || 0),
              totalTokens: Number(result.usage.total_tokens || 0)
            }
          : null,
        privacy: {
          rawImageStoredByUnbound: false,
          providerResponseStorageRequested: false
        },
        security: {
          staticUploadInspection: true,
          malwareScan: {
            mode: malwareScan.mode,
            scanned: malwareScan.scanned,
            clean: malwareScan.clean,
            state: malwareScan.state,
            engine: malwareScan.engine
          }
        }
      });
    } catch (error) {
      const safe = safeImageError(error);
      if (safe.code === "IMAGE_UNDERSTANDING_PROVIDER_FAILED") {
        console.error(
          "UNBOUND AI IMAGE UNDERSTANDING PROVIDER ERROR:",
          error?.code || error?.status || error?.name || "provider-error"
        );
      }
      if (safe.code === "UPLOAD_MALWARE_DETECTED") {
        console.warn(
          "UNBOUND AI IMAGE UNDERSTANDING MALWARE BLOCK:",
          error?.details?.signature || "detected",
          error?.details?.sha256 ? `sha256=${error.details.sha256.slice(0, 16)}` : ""
        );
      }
      if (safe.code === "UPLOAD_MALWARE_SCANNER_UNAVAILABLE") {
        console.warn(
          "UNBOUND AI IMAGE UNDERSTANDING REQUIRED MALWARE SCANNER UNAVAILABLE:",
          error?.details?.reason || "unavailable"
        );
      }
      return res.status(safe.statusCode).json({ error: safe.message, code: safe.code });
    }
  });

  router.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({
        error: "The image-understanding request is too large.",
        code: "IMAGE_UNDERSTANDING_REQUEST_TOO_LARGE"
      });
    }
    if (error instanceof SyntaxError) {
      return res.status(400).json({
        error: "The image-understanding request is invalid.",
        code: "IMAGE_UNDERSTANDING_REQUEST_INVALID"
      });
    }
    return next(error);
  });

  return router;
}

function sendImageUnderstandingPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "images.html"));
}

module.exports = {
  safeImageError,
  logImageMalwareScan,
  createImageUnderstandingRouter,
  sendImageUnderstandingPage
};
