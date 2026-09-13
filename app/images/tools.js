const path = require("path");
const { assertUploadSafe } = require("../security/upload-protection");

const DEFAULT_MAX_EDIT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PROMPT_CHARS = 8000;
const ACCEPTED_EDIT_TYPES = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
});
const ALLOWED_SIZES = Object.freeze(["auto", "1024x1024", "1536x1024", "1024x1536"]);
const ALLOWED_QUALITIES = Object.freeze(["auto", "low", "medium", "high"]);
const ALLOWED_BACKGROUNDS = Object.freeze(["auto", "opaque", "transparent"]);
const ALLOWED_OUTPUT_FORMATS = Object.freeze(["png", "webp", "jpeg"]);
const ALLOWED_INPUT_FIDELITIES = Object.freeze(["low", "high"]);

function positiveIntEnv(env, name, fallback, { min = 1, max = 100_000_000 } = {}) {
  const value = Number.parseInt(String(env?.[name] ?? ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function imageToolError(code, publicMessage, statusCode = 400) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  error.statusCode = statusCode;
  return error;
}

function getImageToolsConfig(env = process.env) {
  return {
    maxEditImageBytes: positiveIntEnv(
      env,
      "IMAGE_TOOLS_MAX_EDIT_BYTES",
      DEFAULT_MAX_EDIT_IMAGE_BYTES,
      { min: 64 * 1024, max: 8 * 1024 * 1024 }
    ),
    jsonBodyLimit: "12mb",
    acceptedEditExtensions: Object.keys(ACCEPTED_EDIT_TYPES),
    allowedSizes: [...ALLOWED_SIZES],
    allowedQualities: [...ALLOWED_QUALITIES],
    allowedBackgrounds: [...ALLOWED_BACKGROUNDS],
    allowedOutputFormats: [...ALLOWED_OUTPUT_FORMATS],
    allowedInputFidelities: [...ALLOWED_INPUT_FIDELITIES]
  };
}

function cleanPrompt(value) {
  const prompt = String(value || "").trim();
  if (!prompt) {
    throw imageToolError("IMAGE_TOOL_PROMPT_REQUIRED", "Describe the image you want to create or the edit you want to make.");
  }
  if (prompt.length > MAX_IMAGE_PROMPT_CHARS) {
    throw imageToolError(
      "IMAGE_TOOL_PROMPT_TOO_LONG",
      `Image instructions must be ${MAX_IMAGE_PROMPT_CHARS} characters or fewer.`
    );
  }
  return prompt;
}

function oneOf(value, allowed, fallback) {
  const normalized = String(value || fallback).trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function cleanOutputOptions(body = {}) {
  const outputFormat = oneOf(body.outputFormat, ALLOWED_OUTPUT_FORMATS, "png");
  let background = oneOf(body.background, ALLOWED_BACKGROUNDS, "auto");
  if (background === "transparent" && outputFormat === "jpeg") {
    background = "opaque";
  }
  return {
    size: oneOf(body.size, ALLOWED_SIZES, "1024x1024"),
    quality: oneOf(body.quality, ALLOWED_QUALITIES, "medium"),
    background,
    outputFormat
  };
}

function cleanFilename(value) {
  const filename = String(value || "").trim();
  if (!filename || filename.length > 180) return null;
  if (filename !== path.basename(filename)) return null;
  if (/[\u0000-\u001f\u007f]/.test(filename)) return null;
  return filename;
}

function decodeStrictBase64(value, maxBytes) {
  const base64 = String(value || "").trim();
  if (!base64 || base64.startsWith("data:")) {
    throw imageToolError("IMAGE_TOOL_EDIT_DATA_INVALID", "The source image data is invalid.");
  }
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4 + 4;
  if (base64.length > maxEncodedLength) {
    throw imageToolError(
      "IMAGE_TOOL_EDIT_IMAGE_TOO_LARGE",
      `Edit images must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller.`,
      413
    );
  }
  if (
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw imageToolError("IMAGE_TOOL_EDIT_DATA_INVALID", "The source image data is invalid.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) {
    throw imageToolError("IMAGE_TOOL_EDIT_IMAGE_EMPTY", "Choose a non-empty image to edit.");
  }
  if (bytes.length > maxBytes) {
    throw imageToolError(
      "IMAGE_TOOL_EDIT_IMAGE_TOO_LARGE",
      `Edit images must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller.`,
      413
    );
  }
  if (bytes.toString("base64") !== base64) {
    throw imageToolError("IMAGE_TOOL_EDIT_DATA_INVALID", "The source image data is invalid.");
  }
  return { base64, buffer: bytes, bytes: bytes.length };
}

function normalizeGenerateRequest(body = {}) {
  return {
    prompt: cleanPrompt(body.prompt),
    ...cleanOutputOptions(body)
  };
}

function normalizeEditRequest(body = {}, env = process.env) {
  const config = getImageToolsConfig(env);
  const filename = cleanFilename(body.filename);
  if (!filename) {
    throw imageToolError("IMAGE_TOOL_EDIT_FILENAME_INVALID", "Choose an image with a valid filename.");
  }
  const extension = path.extname(filename).toLowerCase();
  const mimeType = ACCEPTED_EDIT_TYPES[extension];
  if (!mimeType) {
    throw imageToolError(
      "IMAGE_TOOL_EDIT_TYPE_UNSUPPORTED",
      "Image editing currently supports PNG, JPEG, and WEBP files."
    );
  }
  const decoded = decodeStrictBase64(body.imageBase64, config.maxEditImageBytes);
  try {
    assertUploadSafe({ filename, buffer: decoded.buffer, kind: "image" });
  } catch (error) {
    throw imageToolError(
      "IMAGE_TOOL_EDIT_SECURITY_REJECTED",
      error?.publicMessage || "That upload was blocked by UNBOUND AI upload protection."
    );
  }
  return {
    filename,
    mimeType,
    imageBase64: decoded.base64,
    imageBuffer: decoded.buffer,
    imageBytes: decoded.bytes,
    prompt: cleanPrompt(body.prompt),
    inputFidelity: oneOf(body.inputFidelity, ALLOWED_INPUT_FIDELITIES, "high"),
    ...cleanOutputOptions(body)
  };
}

function publicImageToolsConfig(env = process.env) {
  const config = getImageToolsConfig(env);
  return {
    maxPromptChars: MAX_IMAGE_PROMPT_CHARS,
    maxEditImageBytes: config.maxEditImageBytes,
    acceptedEditExtensions: config.acceptedEditExtensions,
    allowedSizes: config.allowedSizes,
    allowedQualities: config.allowedQualities,
    allowedBackgrounds: config.allowedBackgrounds,
    allowedOutputFormats: config.allowedOutputFormats,
    allowedInputFidelities: config.allowedInputFidelities,
    oneImagePerRequest: true,
    generatedImagesStoredByUnbound: false,
    rawEditImagesStoredByUnbound: false,
    uploadProtection: true
  };
}

module.exports = {
  DEFAULT_MAX_EDIT_IMAGE_BYTES,
  MAX_IMAGE_PROMPT_CHARS,
  ACCEPTED_EDIT_TYPES,
  ALLOWED_SIZES,
  ALLOWED_QUALITIES,
  ALLOWED_BACKGROUNDS,
  ALLOWED_OUTPUT_FORMATS,
  ALLOWED_INPUT_FIDELITIES,
  getImageToolsConfig,
  imageToolError,
  cleanOutputOptions,
  normalizeGenerateRequest,
  normalizeEditRequest,
  publicImageToolsConfig
};
