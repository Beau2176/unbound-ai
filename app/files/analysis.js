const path = require("path");
const { assertUploadSafe } = require("../security/upload-protection");

const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 4000;
const MAX_FILENAME_CHARS = 180;

const ACCEPTED_FILE_TYPES = Object.freeze({
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".html": "text/html",
  ".xml": "application/xml",
  ".csv": "text/csv",
  ".tsv": "text/tsv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
});

const DEFAULT_ANALYSIS_PROMPT =
  "Analyze this file. Summarize the most important information, identify notable facts or patterns, flag uncertainties or problems, and give practical takeaways. Do not invent content you cannot reliably read.";

function positiveIntEnv(env, name, fallback, { min = 1, max = 100_000_000 } = {}) {
  const value = Number.parseInt(String(env?.[name] ?? ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function getFileAnalysisConfig(env = process.env) {
  return {
    maxFileBytes: positiveIntEnv(
      env,
      "FILE_ANALYSIS_MAX_BYTES",
      DEFAULT_MAX_FILE_BYTES,
      { min: 64 * 1024, max: 8 * 1024 * 1024 }
    ),
    jsonBodyLimit: "12mb",
    acceptedExtensions: Object.keys(ACCEPTED_FILE_TYPES)
  };
}

function fileAnalysisError(code, publicMessage, statusCode = 400) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  error.statusCode = statusCode;
  return error;
}

function cleanFilename(value) {
  const filename = String(value || "").trim();
  if (!filename || filename.length > MAX_FILENAME_CHARS) return null;
  if (filename !== path.basename(filename)) return null;
  if (/[\u0000-\u001f\u007f]/.test(filename)) return null;
  if (filename === "." || filename === "..") return null;
  return filename;
}

function resolveAcceptedFileType(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  const mimeType = ACCEPTED_FILE_TYPES[extension] || null;
  return mimeType ? { extension, mimeType } : null;
}

function cleanPrompt(value) {
  const prompt = String(value || "").trim();
  if (!prompt) return DEFAULT_ANALYSIS_PROMPT;
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw fileAnalysisError(
      "FILE_ANALYSIS_PROMPT_TOO_LONG",
      `File-analysis instructions must be ${MAX_PROMPT_CHARS} characters or fewer.`
    );
  }
  return prompt;
}

function cleanPdfDetail(value) {
  const detail = String(value || "low").trim().toLowerCase();
  return ["low", "high", "auto"].includes(detail) ? detail : "low";
}

function decodeStrictBase64(value, maxFileBytes) {
  const base64 = String(value || "").trim();
  if (!base64 || base64.startsWith("data:")) {
    throw fileAnalysisError(
      "FILE_ANALYSIS_DATA_INVALID",
      "The uploaded file data is invalid."
    );
  }

  const maxEncodedLength = Math.ceil(maxFileBytes / 3) * 4 + 4;
  if (base64.length > maxEncodedLength) {
    throw fileAnalysisError(
      "FILE_ANALYSIS_FILE_TOO_LARGE",
      `Files must be ${Math.floor(maxFileBytes / (1024 * 1024))} MB or smaller.`,
      413
    );
  }

  if (
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw fileAnalysisError(
      "FILE_ANALYSIS_DATA_INVALID",
      "The uploaded file data is invalid."
    );
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > maxFileBytes) {
    throw fileAnalysisError(
      buffer.length > maxFileBytes
        ? "FILE_ANALYSIS_FILE_TOO_LARGE"
        : "FILE_ANALYSIS_FILE_EMPTY",
      buffer.length > maxFileBytes
        ? `Files must be ${Math.floor(maxFileBytes / (1024 * 1024))} MB or smaller.`
        : "Choose a non-empty file to analyze.",
      buffer.length > maxFileBytes ? 413 : 400
    );
  }

  if (buffer.toString("base64") !== base64) {
    throw fileAnalysisError(
      "FILE_ANALYSIS_DATA_INVALID",
      "The uploaded file data is invalid."
    );
  }

  return { base64, bytes: buffer.length, buffer };
}

function normalizeFileAnalysisRequest(body, env = process.env) {
  const config = getFileAnalysisConfig(env);
  const filename = cleanFilename(body?.filename);
  if (!filename) {
    throw fileAnalysisError(
      "FILE_ANALYSIS_FILENAME_INVALID",
      "Choose a file with a valid filename."
    );
  }

  const fileType = resolveAcceptedFileType(filename);
  if (!fileType) {
    throw fileAnalysisError(
      "FILE_ANALYSIS_TYPE_UNSUPPORTED",
      "That file type is not supported yet. Use PDF, text/Markdown, JSON/XML/HTML, CSV/TSV, Word/RTF/ODT, PowerPoint, or Excel."
    );
  }

  const decoded = decodeStrictBase64(body?.fileBase64, config.maxFileBytes);
  try {
    assertUploadSafe({ filename, buffer: decoded.buffer, kind: "file" });
  } catch (error) {
    throw fileAnalysisError(
      "FILE_ANALYSIS_SECURITY_REJECTED",
      error?.publicMessage || "That upload was blocked by UNBOUND AI upload protection."
    );
  }

  const prompt = cleanPrompt(body?.prompt);
  const detail = fileType.extension === ".pdf" ? cleanPdfDetail(body?.detail) : null;

  return {
    filename,
    extension: fileType.extension,
    mimeType: fileType.mimeType,
    fileBase64: decoded.base64,
    fileBytes: decoded.bytes,
    prompt,
    detail
  };
}

function publicFileAnalysisConfig(env = process.env) {
  const config = getFileAnalysisConfig(env);
  return {
    maxFileBytes: config.maxFileBytes,
    maxPromptChars: MAX_PROMPT_CHARS,
    acceptedExtensions: config.acceptedExtensions,
    defaultPdfDetail: "low",
    rawFilesStoredByUnbound: false,
    providerResponseStorageRequested: false,
    uploadProtection: true
  };
}

module.exports = {
  DEFAULT_MAX_FILE_BYTES,
  MAX_PROMPT_CHARS,
  ACCEPTED_FILE_TYPES,
  DEFAULT_ANALYSIS_PROMPT,
  getFileAnalysisConfig,
  fileAnalysisError,
  cleanFilename,
  resolveAcceptedFileType,
  cleanPdfDetail,
  decodeStrictBase64,
  normalizeFileAnalysisRequest,
  publicFileAnalysisConfig
};
