const express = require("express");
const path = require("path");
const { generateImage, editImage, getImageGatewayStatus } = require("./gateway");
const {
  getImageToolsConfig,
  normalizeGenerateRequest,
  normalizeEditRequest,
  publicImageToolsConfig
} = require("./tools");

function safeImageToolError(error) {
  const code = String(error?.code || "");
  if (code === "IMAGE_PROVIDER_NOT_CONFIGURED") {
    return {
      statusCode: 503,
      code,
      message: "Image creation is temporarily unavailable because the AI provider is not configured."
    };
  }
  if (
    code === "IMAGE_PROVIDER_UNSUPPORTED" ||
    code === "IMAGE_PROVIDER_GENERATION_UNSUPPORTED" ||
    code === "IMAGE_PROVIDER_EDITING_UNSUPPORTED"
  ) {
    return {
      statusCode: 503,
      code,
      message: "The configured AI provider does not support this image operation."
    };
  }
  if (code.startsWith("IMAGE_TOOL_")) {
    return {
      statusCode: Number(error?.statusCode) || 400,
      code,
      message: error?.publicMessage || "The image request is invalid."
    };
  }
  return {
    statusCode: 502,
    code: "IMAGE_TOOL_PROVIDER_FAILED",
    message: "The AI provider could not complete that image request. Try again shortly."
  };
}

async function recordImageUsage({
  recordUsageEvent,
  userId,
  result,
  eventType
}) {
  if (typeof recordUsageEvent !== "function") return;
  try {
    await recordUsageEvent({
      userId: userId || null,
      provider: result.provider,
      model: result.model,
      eventType,
      usage: result.usage,
      webSearchCalls: 0,
      // The existing estimator is for chat-token pricing only. Image output uses
      // different token economics, so leave this unset until a dedicated image
      // cost estimator is implemented rather than recording a false estimate.
      estimatedCostMicros: null,
      providerResponseId: null
    });
  } catch (usageError) {
    console.error(
      "UNBOUND AI IMAGE TOOL USAGE RECORD ERROR:",
      usageError?.code || usageError?.message || "unknown"
    );
  }
}

function createImageToolsRouter({ recordUsageEvent = null, env = process.env } = {}) {
  const router = express.Router();
  const config = getImageToolsConfig(env);
  router.use(express.json({ limit: config.jsonBodyLimit, type: "application/json" }));

  router.get("/status", (req, res) => {
    const ai = getImageGatewayStatus(env);
    return res.json({
      configured: Boolean(ai.configured && ai.imageGeneration && ai.imageEditing),
      provider: ai.provider || null,
      model: ai.imageModel || null,
      generation: Boolean(ai.imageGeneration),
      editing: Boolean(ai.imageEditing),
      limits: publicImageToolsConfig(env)
    });
  });

  router.post("/generate", async (req, res) => {
    try {
      const ai = getImageGatewayStatus(env);
      if (!ai.configured || !ai.imageGeneration) {
        return res.status(503).json({
          error: "Image generation is temporarily unavailable.",
          code: ai.configured
            ? "IMAGE_PROVIDER_GENERATION_UNSUPPORTED"
            : "IMAGE_PROVIDER_NOT_CONFIGURED"
        });
      }
      const input = normalizeGenerateRequest(req.body);
      const result = await generateImage({ ...input, env });
      await recordImageUsage({
        recordUsageEvent,
        userId: req.user?.id,
        result,
        eventType: "image_generation"
      });
      return res.json({
        ok: true,
        imageBase64: result.imageBase64,
        outputFormat: result.outputFormat,
        size: result.size,
        quality: result.quality,
        background: result.background,
        provider: result.provider,
        model: result.model,
        usage: result.usage || null,
        privacy: {
          generatedImageStoredByUnbound: false
        }
      });
    } catch (error) {
      const safe = safeImageToolError(error);
      if (safe.code === "IMAGE_TOOL_PROVIDER_FAILED") {
        console.error(
          "UNBOUND AI IMAGE GENERATION PROVIDER ERROR:",
          error?.code || error?.status || error?.name || "provider-error"
        );
      }
      return res.status(safe.statusCode).json({ error: safe.message, code: safe.code });
    }
  });

  router.post("/edit", async (req, res) => {
    try {
      const ai = getImageGatewayStatus(env);
      if (!ai.configured || !ai.imageEditing) {
        return res.status(503).json({
          error: "Image editing is temporarily unavailable.",
          code: ai.configured
            ? "IMAGE_PROVIDER_EDITING_UNSUPPORTED"
            : "IMAGE_PROVIDER_NOT_CONFIGURED"
        });
      }
      const input = normalizeEditRequest(req.body, env);
      const result = await editImage({
        filename: input.filename,
        mimeType: input.mimeType,
        imageBuffer: input.imageBuffer,
        prompt: input.prompt,
        inputFidelity: input.inputFidelity,
        size: input.size,
        quality: input.quality,
        background: input.background,
        outputFormat: input.outputFormat,
        env
      });
      await recordImageUsage({
        recordUsageEvent,
        userId: req.user?.id,
        result,
        eventType: "image_edit"
      });
      return res.json({
        ok: true,
        imageBase64: result.imageBase64,
        outputFormat: result.outputFormat,
        size: result.size,
        quality: result.quality,
        background: result.background,
        provider: result.provider,
        model: result.model,
        usage: result.usage || null,
        source: {
          name: input.filename,
          bytes: input.imageBytes,
          type: input.mimeType,
          storedByUnbound: false
        },
        privacy: {
          rawEditImageStoredByUnbound: false,
          generatedImageStoredByUnbound: false
        }
      });
    } catch (error) {
      const safe = safeImageToolError(error);
      if (safe.code === "IMAGE_TOOL_PROVIDER_FAILED") {
        console.error(
          "UNBOUND AI IMAGE EDIT PROVIDER ERROR:",
          error?.code || error?.status || error?.name || "provider-error"
        );
      }
      return res.status(safe.statusCode).json({ error: safe.message, code: safe.code });
    }
  });

  router.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({
        error: "The image-tool request is too large.",
        code: "IMAGE_TOOL_REQUEST_TOO_LARGE"
      });
    }
    if (error instanceof SyntaxError) {
      return res.status(400).json({
        error: "The image-tool request is invalid.",
        code: "IMAGE_TOOL_REQUEST_INVALID"
      });
    }
    return next(error);
  });

  return router;
}

function sendImageToolsPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "image-tools.html"));
}

module.exports = {
  safeImageToolError,
  recordImageUsage,
  createImageToolsRouter,
  sendImageToolsPage
};
