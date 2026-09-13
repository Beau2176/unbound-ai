const path = require("path");
const { assertUploadSafe } = require("../security/upload-protection");

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 4000;
const MAX_FILENAME_CHARS = 180;
const ACCEPTED_IMAGE_TYPES = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
});
const DEFAULT_IMAGE_PROMPT =
  "Analyze this image. Describe the important visible content, read relevant visible text when reliable, identify notable details or patterns, flag uncertainty, and give practical takeaways. Do not invent details you cannot see.";

function positiveIntEnv(env, name, fallback, { min = 1, max = 100_000_000 } = {}) {
  const value = Number.parseInt(String(env?.[name] ?? ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function imageUnderstandingError(code, publicMessage, statusCode = 400) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  error.statusCode = statusCode;
  return error;
}

function getImageUnderstandingConfig(env = process.env) {
  return {
    maxImageBytes: positiveIntEnv(
      env,
      "IMAGE_UNDERSTANDING_MAX_BYTES",
      DEFAULT_MAX_IMAGE_BYTES,
      { min: 64 * 1024, max: 8 * 1024 * 1024 }
    ),
    jsonBodyLimit: "12mb",
    acceptedExtensions: Object.keys(ACCEPTED_IMAGE_TYPES)
  };
}

function cleanFilename(value) {
  const filename = String(value || "").trim();
  if (!filename || filename.length > MAX_FILENAME_CHARS) return null;
  if (filename !== path.basename(filename)) return null;
  if (/[\u0000-\u001f\u007f]/.test(filename)) return null;
  if (filename === "." || filename === "..") return null;
  return filename;
}

function resolveImageType(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  const mimeType = ACCEPTED_IMAGE_TYPES[extension] || null;
  return mimeType ? { extension, mimeType } : null;
}

function cleanPrompt(value) {
  const prompt = String(value || "").trim();
  if (!prompt) return DEFAULT_IMAGE_PROMPT;
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw imageUnderstandingError(
      "IMAGE_UNDERSTANDING_PROMPT_TOO_LONG",
      `Image instructions must be ${MAX_PROMPT_CHARS} characters or fewer.`
    );
  }
  return prompt;
}

function cleanImageDetail(value) {
  const detail = String(value || "auto").trim().toLowerCase();
  return ["low", "high", "auto"].includes(detail) ? detail : "auto";
}

function decodeStrictBase64(value, maxImageBytes) {
  const base64 = String(value || "").trim();
  if (!base64 || base64.startsWith("data:")) {
    throw imageUnderstandingError(
      "IMAGE_UNDERSTANDING_DATA_INVALID",
      "The uploaded image data is invalid."
    );
  }
  const maxEncodedLength = Math.ceil(maxImageBytes / 3) * 4 + 4;
  if (base64.length > maxEncodedLength) {
    throw imageUnderstandingError(
      "IMAGE_UNDERSTANDING_IMAGE_TOO_LARGE",
      `Images must be ${Math.floor(maxImageBytes / (1024 * 1024))} MB or smaller.`,
      413
    );
  }
  if (
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw imageUnderstandingError(
      "IMAGE_UNDERSTANDING_DATA_INVALID",
      "The uploaded image data is invalid."
    );
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > maxImageBytes) {
    throw imageUnderstandingError(
      buffer.length > maxImageBytes
        ? "IMAGE_UNDERSTANDING_IMAGE_TOO_LARGE"
        : "IMAGE_UNDERSTANDING_IMAGE_EMPTY",
      buffer.length > maxImageBytes
        ? `Images must be ${Math.floor(maxImageBytes / (1024 * 1024))} MB or smaller.`
        : "Choose a non-empty image to analyze.",
      buffer.length > maxImageBytes ? 413 : 400
    );
  }
  if (buffer.toString("base64") !== base64) {
    throw imageUnderstandingError(
      "IMAGE_UNDERSTANDING_DATA_INVALID",
      "The uploaded image data is invalid."
    );
  }
  return { base64, bytes: buffer.length, buffer };
}

function normalizeImageUnderstandingRequest(body, env = process.env) {
  const config = getImageUnderstandingConfig(env);
  const filename = cleanFilename(body?.filename);
  if (!filename) {
    throw imageUnderstandingError(
      "IMAGE_UNDERSTANDING_FILENAME_INVALID",
      "Choose an image with a valid filename."
    );
  }
  const imageType = resolveImageType(filename);
  if (!imageType) {
    throw imageUnderstandingError(
      "IMAGE_UNDERSTANDING_TYPE_UNSUPPORTED",
      "That image type is not supported yet. Use PNG, JPEG, WEBP, or GIF."
    );
  }
  const decoded = decodeStrictBase64(body?.imageBase64, config.maxImageBytes);
  try {
    assertUploadSafe({ filename, buffer: decoded.buffer, kind: "image" });
  } catch (error) {
    throw imageUnderstandingError(
      "IMAGE_UNDERSTANDING_SECURITY_REJECTED",
      error?.publicMessage || "That upload was blocked by UNBOUND AI upload protection."
    );
  }
  return {
    filename,
    extension: imageType.extension,
    mimeType: imageType.mimeType,
    imageBase64: decoded.base64,
    imageBytes: decoded.bytes,
    prompt: cleanPrompt(body?.prompt),
    detail: cleanImageDetail(body?.detail)
  };
}

function publicImageUnderstandingConfig(env = process.env) {
  const config = getImageUnderstandingConfig(env);
  return {
    maxImageBytes: config.maxImageBytes,
    maxPromptChars: MAX_PROMPT_CHARS,
    acceptedExtensions: config.acceptedExtensions,
    defaultDetail: "auto",
    rawImagesStoredByUnbound: false,
    providerResponseStorageRequested: false,
    uploadProtection: true
  };
}

module.exports = {
  DEFAULT_MAX_IMAGE_BYTES,
  MAX_PROMPT_CHARS,
  ACCEPTED_IMAGE_TYPES,
  DEFAULT_IMAGE_PROMPT,
  getImageUnderstandingConfig,
  imageUnderstandingError,
  cleanFilename,
  resolveImageType,
  cleanImageDetail,
  decodeStrictBase64,
  normalizeImageUnderstandingRequest,
  publicImageUnderstandingConfig
};
