const express = require("express");
const fs = require("fs");
const path = require("path");
const { analyzeFile, getGatewayStatus } = require("../ai/gateway");
const {
  runWithRequestCancellation,
  handleCancelledJsonResponse
} = require("../ops/request-cancellation");
const { injectEmailAccountUi } = require("../email/account-page");
const { listAiStyles } = require("../preferences/ai-style");
const {
  scanBufferForMalware,
  publicMalwareScanStatus
} = require("../security/malware-scan");
const {
  getFileAnalysisConfig,
  normalizeFileAnalysisRequest,
  publicFileAnalysisConfig
} = require("./analysis");

const INDEX_NAV_MARKER = '<a class="account-button advertiser-link" href="/advertisers.html">ADVERTISE</a>';
const FILES_NAV_LINK = '<a class="account-button advertiser-link" href="/files.html">FILES</a>';
const ARTIFACTS_NAV_LINK = '<a class="account-button advertiser-link" href="/artifact-studio.html">CREATE</a>';
const IMAGES_NAV_LINK = '<a class="account-button advertiser-link" href="/images.html">IMAGES</a>';
const IMAGE_STUDIO_NAV_LINK = '<a class="account-button advertiser-link" href="/image-tools.html">STUDIO</a>';
const VOICE_NAV_LINK = '<a class="account-button advertiser-link" href="/voice.html">VOICE</a>';
const TASKS_NAV_LINK = '<a class="account-button advertiser-link" href="/tasks.html">TASKS</a>';
const AGENTS_NAV_LINK = '<a class="account-button advertiser-link" href="/agents.html">AGENTS</a>';
const MEMORY_NAV_LINK = '<a class="account-button advertiser-link" href="/memory.html">MEMORY</a>';
const MODES_NAV_LINK = '<a class="account-button advertiser-link" href="/modes.html">MODES</a>';
const COMMAND_CENTER_NAV_LINK = '<a class="account-button advertiser-link" href="/command-center.html">CENTER</a>';

const LEGACY_STYLE_OPTIONS = `              <option value="balanced">BALANCED</option>
              <option value="straight">STRAIGHT SHOOTER</option>
              <option value="professional">PROFESSIONAL</option>
              <option value="warm">WARM</option>
              <option value="playful">PLAYFUL</option>`;

const LEGACY_STYLE_FUNCTIONS = `    function normalizeAiStyle(value) {
      return ["balanced", "straight", "professional", "warm", "playful"].includes(value)
        ? value
        : "balanced";
    }

    function aiStyleLabel(value) {
      return ({
        balanced: "Balanced",
        straight: "Straight Shooter",
        professional: "Professional",
        warm: "Warm",
        playful: "Playful"
      })[normalizeAiStyle(value)];
    }`;

function replaceExactlyOnce(source, marker, replacement, code) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1 || first !== last) {
    const error = new Error(`Expected exactly one UNBOUND index marker for ${code}.`);
    error.code = "FILE_ANALYSIS_INDEX_MARKER_CHANGED";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function buildAiStyleOptions(styles = listAiStyles()) {
  return styles
    .map((style) => `              <option value="${style.id}">${style.label.toUpperCase()}</option>`)
    .join("\n");
}

function buildAiStyleBrowserFunctions(styles = listAiStyles()) {
  const ids = styles.map((style) => style.id);
  const labels = Object.fromEntries(styles.map((style) => [style.id, style.label]));
  return `    const UNBOUND_AI_STYLE_IDS = Object.freeze(${JSON.stringify(ids)});
    const UNBOUND_AI_STYLE_LABELS = Object.freeze(${JSON.stringify(labels)});

    function normalizeAiStyle(value) {
      const normalized = String(value || "").trim().toLowerCase();
      return UNBOUND_AI_STYLE_IDS.includes(normalized) ? normalized : "balanced";
    }

    function aiStyleLabel(value) {
      return UNBOUND_AI_STYLE_LABELS[normalizeAiStyle(value)] || "Balanced";
    }`;
}

function safeProviderError(error) {
  const code = String(error?.code || "");
  if (code === "AI_PROVIDER_NOT_CONFIGURED") return { statusCode: 503, code, message: "File analysis is temporarily unavailable because the AI provider is not configured." };
  if (code === "AI_PROVIDER_FILE_ANALYSIS_UNSUPPORTED") return { statusCode: 503, code, message: "The configured AI provider does not support file analysis." };
  if (code === "UPLOAD_MALWARE_DETECTED") return { statusCode: 400, code, message: "That upload was blocked because malware was detected." };
  if (code === "UPLOAD_MALWARE_SCANNER_UNAVAILABLE") return { statusCode: 503, code, message: "Upload malware scanning is temporarily unavailable. Try again shortly." };
  if (code === "UPLOAD_MALWARE_SCAN_INPUT_INVALID") return { statusCode: 400, code, message: "The upload could not be scanned safely." };
  if (code.startsWith("FILE_ANALYSIS_")) return { statusCode: Number(error?.statusCode) || 400, code, message: error?.publicMessage || "The uploaded file could not be analyzed." };
  return { statusCode: 502, code: "FILE_ANALYSIS_PROVIDER_FAILED", message: "The AI provider could not analyze that file. Try again shortly." };
}

function logMalwareScanResult(result, context) {
  if (!result || result.state !== "unavailable") return;
  console.warn(
    `UNBOUND AI ${context} MALWARE SCAN DEGRADED:`,
    result.internalReason || "scanner-unavailable",
    result.sha256 ? `sha256=${result.sha256.slice(0, 16)}` : ""
  );
}

function createFileAnalysisRouter({ recordUsageEvent = null, estimateProviderCostMicros = null, env = process.env } = {}) {
  const router = express.Router();
  const config = getFileAnalysisConfig(env);
  router.use(express.json({ limit: config.jsonBodyLimit, type: "application/json" }));
  router.get("/status", (req, res) => {
    const ai = getGatewayStatus();
    return res.json({
      configured: Boolean(ai.configured && ai.fileAnalysis),
      provider: ai.provider || null,
      model: ai.model || null,
      limits: publicFileAnalysisConfig(env),
      malwareScan: publicMalwareScanStatus(env)
    });
  });
  router.post("/", async (req, res) => {
    try {
      const ai = getGatewayStatus();
      if (!ai.configured || !ai.fileAnalysis) return res.status(503).json({ error: "File analysis is temporarily unavailable.", code: ai.configured ? "AI_PROVIDER_FILE_ANALYSIS_UNSUPPORTED" : "AI_PROVIDER_NOT_CONFIGURED" });
      const input = normalizeFileAnalysisRequest(req.body, env);
      const malwareScan = await scanBufferForMalware({
        filename: input.filename,
        buffer: Buffer.from(input.fileBase64, "base64"),
        env
      });
      logMalwareScanResult(malwareScan, "FILE ANALYSIS");
      const result = await runWithRequestCancellation(
        req,
        res,
        (signal) => analyzeFile({
          filename: input.filename,
          mimeType: input.mimeType,
          fileBase64: input.fileBase64,
          prompt: input.prompt,
          detail: input.detail || "low",
          signal
        })
      );
      if (typeof recordUsageEvent === "function") {
        const estimatedCostMicros = typeof estimateProviderCostMicros === "function" ? estimateProviderCostMicros(result.provider, result.usage) : null;
        try {
          await recordUsageEvent({ userId: req.user?.id || null, provider: result.provider, model: result.model, eventType: "file_analysis", usage: result.usage, webSearchCalls: 0, estimatedCostMicros, providerResponseId: result.responseId });
        } catch (usageError) {
          console.error("UNBOUND AI FILE ANALYSIS USAGE RECORD ERROR:", usageError?.code || usageError?.message || "unknown");
        }
      }
      return res.json({ ok: true, analysis: result.reply || "", file: { name: input.filename, bytes: input.fileBytes, type: input.mimeType, pdfDetail: input.detail || null }, provider: result.provider, model: result.model, usage: result.usage ? { inputTokens: Number(result.usage.input_tokens || 0), outputTokens: Number(result.usage.output_tokens || 0), totalTokens: Number(result.usage.total_tokens || 0) } : null, privacy: { rawFileStoredByUnbound: false, providerResponseStorageRequested: false }, security: { staticUploadInspection: true, malwareScan: { mode: malwareScan.mode, scanned: malwareScan.scanned, clean: malwareScan.clean, state: malwareScan.state, engine: malwareScan.engine } } });
    } catch (error) {
      if (handleCancelledJsonResponse(res, error)) return;
      const safe = safeProviderError(error);
      if (safe.code === "FILE_ANALYSIS_PROVIDER_FAILED") console.error("UNBOUND AI FILE ANALYSIS PROVIDER ERROR:", error?.code || error?.status || error?.name || "provider-error");
      if (safe.code === "UPLOAD_MALWARE_DETECTED") {
        console.warn(
          "UNBOUND AI FILE ANALYSIS MALWARE BLOCK:",
          error?.details?.signature || "detected",
          error?.details?.sha256 ? `sha256=${error.details.sha256.slice(0, 16)}` : ""
        );
      }
      if (safe.code === "UPLOAD_MALWARE_SCANNER_UNAVAILABLE") {
        console.warn("UNBOUND AI FILE ANALYSIS REQUIRED MALWARE SCANNER UNAVAILABLE:", error?.details?.reason || "unavailable");
      }
      return res.status(safe.statusCode).json({ error: safe.message, code: safe.code });
    }
  });
  router.use((error, req, res, next) => {
    if (error?.type === "entity.too.large") return res.status(413).json({ error: "The file-analysis request is too large.", code: "FILE_ANALYSIS_REQUEST_TOO_LARGE" });
    if (error instanceof SyntaxError) return res.status(400).json({ error: "The file-analysis request is invalid.", code: "FILE_ANALYSIS_REQUEST_INVALID" });
    return next(error);
  });
  return router;
}

function sendFileAnalysisPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "files.html"));
}

function buildFileAwareIndexHtml(indexHtml) {
  let source = String(indexHtml || "");
  source = replaceExactlyOnce(
    source,
    INDEX_NAV_MARKER,
    `${INDEX_NAV_MARKER}\n      ${FILES_NAV_LINK}\n      ${ARTIFACTS_NAV_LINK}\n      ${IMAGES_NAV_LINK}\n      ${IMAGE_STUDIO_NAV_LINK}\n      ${VOICE_NAV_LINK}\n      ${TASKS_NAV_LINK}\n      ${AGENTS_NAV_LINK}\n      ${MEMORY_NAV_LINK}\n      ${MODES_NAV_LINK}\n      ${COMMAND_CENTER_NAV_LINK}`,
    "product-navigation"
  );
  source = replaceExactlyOnce(
    source,
    LEGACY_STYLE_OPTIONS,
    buildAiStyleOptions(),
    "100-mode-options"
  );
  source = replaceExactlyOnce(
    source,
    LEGACY_STYLE_FUNCTIONS,
    buildAiStyleBrowserFunctions(),
    "100-mode-browser-functions"
  );
  return injectEmailAccountUi(source);
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
    console.error("UNBOUND AI FILE NAVIGATION INTEGRATION ERROR:", error?.code || error?.message || "unknown");
    return res.status(500).send("UNBOUND AI could not load the chat interface.");
  }
}

module.exports = {
  INDEX_NAV_MARKER,
  FILES_NAV_LINK,
  ARTIFACTS_NAV_LINK,
  IMAGES_NAV_LINK,
  IMAGE_STUDIO_NAV_LINK,
  VOICE_NAV_LINK,
  TASKS_NAV_LINK,
  AGENTS_NAV_LINK,
  MEMORY_NAV_LINK,
  MODES_NAV_LINK,
  COMMAND_CENTER_NAV_LINK,
  LEGACY_STYLE_OPTIONS,
  LEGACY_STYLE_FUNCTIONS,
  replaceExactlyOnce,
  buildAiStyleOptions,
  buildAiStyleBrowserFunctions,
  safeProviderError,
  logMalwareScanResult,
  createFileAnalysisRouter,
  sendFileAnalysisPage,
  buildFileAwareIndexHtml,
  sendFileAwareIndex
};
