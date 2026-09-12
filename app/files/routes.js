const express = require("express");
const fs = require("fs");
const path = require("path");
const { analyzeFile, getGatewayStatus } = require("../ai/gateway");
const { injectEmailAccountUi } = require("../email/account-page");
const {
  getFileAnalysisConfig,
  normalizeFileAnalysisRequest,
  publicFileAnalysisConfig
} = require("./analysis");

const INDEX_NAV_MARKER =
  '<a class="account-button advertiser-link" href="/advertisers.html">ADVERTISE</a>';
const FILES_NAV_LINK =
  '<a class="account-button advertiser-link" href="/files.html">FILES</a>';
const IMAGES_NAV_LINK =
  '<a class="account-button advertiser-link" href="/images.html">IMAGES</a>';
const IMAGE_STUDIO_NAV_LINK =
  '<a class="account-button advertiser-link" href="/image-tools.html">STUDIO</a>';

function safeProviderError(error) {
  const code = String(error?.code || "");
  if (code === "AI_PROVIDER_NOT_CONFIGURED") {
    return {
      statusCode: 503,
      code,
      message: "File analysis is temporarily unavailable because the AI provider is not configured."
    };
  }
  if (code === "AI_PROVIDER_FILE_ANALYSIS_UNSUPPORTED") {
    return {
      statusCode: 503,
      code,
      message: "The configured AI provider does not support file analysis."
    };
  }
  if (code.startsWith("FILE_ANALYSIS_")) {
    return {
      statusCode: Number(error?.statusCode) || 400,
      code,
      message: error?.publicMessage || "The uploaded file could not be analyzed."
    };
  }
  return {
    statusCode: 502,
    code: "FILE_ANALYSIS_PROVIDER_FAILED",
    message: "The AI provider could not analyze that file. Try again shortly."
  };
}

function createFileAnalysisRouter({
  recordUsageEvent = null,
  estimateProviderCostMicros = null,
  env = process.env
} = {}) {
  const router = express.Router();
  const config = getFileAnalysisConfig(env);

  router.use(express.json({ limit: config.jsonBodyLimit, type: "application/json" }));

  router.get("/status", (req, res) => {
    const ai = getGatewayStatus();
    return res.json({
      configured: Boolean(ai.configured && ai.fileAnalysis),
      provider: ai.provider || null,
      model: ai.model || null,
      limits: publicFileAnalysisConfig(env)
    });
  });

  router.post("/", async (req, res) => {
    try {
      const ai = getGatewayStatus();
      if (!ai.configured || !ai.fileAnalysis) {
        return res.status(503).json({
          error: "File analysis is temporarily unavailable.",
          code: ai.configured
            ? "AI_PROVIDER_FILE_ANALYSIS_UNSUPPORTED"
            : "AI_PROVIDER_NOT_CONFIGURED"
        });
      }

      const input = normalizeFileAnalysisRequest(req.body, env);
      const result = await analyzeFile({
        filename: input.filename,
        mimeType: input.mimeType,
        fileBase64: input.fileBase64,
        prompt: input.prompt,
        detail: input.detail || "low"
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
            eventType: "file_analysis",
            usage: result.usage,
            webSearchCalls: 0,
            estimatedCostMicros,
            providerResponseId: result.responseId
          });
        } catch (usageError) {
          console.error(
            "UNBOUND AI FILE ANALYSIS USAGE RECORD ERROR:",
            usageError?.code || usageError?.message || "unknown"
          );
        }
      }

      return res.json({
        ok: true,
        analysis: result.reply || "",
        file: {
          name: input.filename,
          bytes: input.fileBytes,
          type: input.mimeType,
          pdfDetail: input.detail || null
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
          rawFileStoredByUnbound: false,
          providerResponseStorageRequested: false
        }
      });
    } catch (error) {
      const safe = safeProviderError(error);
      if (safe.code === "FILE_ANALYSIS_PROVIDER_FAILED") {
        console.error(
          "UNBOUND AI FILE ANALYSIS PROVIDER ERROR:",
          error?.code || error?.status || error?.name || "provider-error"
        );
      }
      return res.status(safe.statusCode).json({
        error: safe.message,
        code: safe.code
      });
    }
  });

  router.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({
        error: "The file-analysis request is too large.",
        code: "FILE_ANALYSIS_REQUEST_TOO_LARGE"
      });
    }
    if (error instanceof SyntaxError) {
      return res.status(400).json({
        error: "The file-analysis request is invalid.",
        code: "FILE_ANALYSIS_REQUEST_INVALID"
      });
    }
    return next(error);
  });

  return router;
}

function sendFileAnalysisPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "files.html"));
}

function buildFileAwareIndexHtml(indexHtml) {
  const source = String(indexHtml || "");
  const matches = source.split(INDEX_NAV_MARKER).length - 1;
  if (matches !== 1) {
    const error = new Error(
      `Expected exactly one UNBOUND index navigation marker; found ${matches}.`
    );
    error.code = "FILE_ANALYSIS_INDEX_MARKER_CHANGED";
    throw error;
  }

  const withProductNavigation = source.replace(
    INDEX_NAV_MARKER,
    `${INDEX_NAV_MARKER}\n      ${FILES_NAV_LINK}\n      ${IMAGES_NAV_LINK}\n      ${IMAGE_STUDIO_NAV_LINK}`
  );
  return injectEmailAccountUi(withProductNavigation);
}

let cachedIndexHtml = null;

function sendFileAwareIndex(req, res) {
  try {
    if (!cachedIndexHtml) {
      const indexPath = path.join(__dirname, "..", "index.html");
      cachedIndexHtml = buildFileAwareIndexHtml(fs.readFileSync(indexPath, "utf8"));
    }
    res.setHeader("Cache-Control", "no-cache");
    res.type("html");
    return res.send(cachedIndexHtml);
  } catch (error) {
    console.error(
      "UNBOUND AI FILE NAVIGATION INTEGRATION ERROR:",
      error?.code || error?.message || "unknown"
    );
    return res.status(500).send("UNBOUND AI could not load the chat interface.");
  }
}

module.exports = {
  INDEX_NAV_MARKER,
  FILES_NAV_LINK,
  IMAGES_NAV_LINK,
  IMAGE_STUDIO_NAV_LINK,
  safeProviderError,
  createFileAnalysisRouter,
  sendFileAnalysisPage,
  buildFileAwareIndexHtml,
  sendFileAwareIndex
};
