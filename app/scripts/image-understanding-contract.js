const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DEFAULT_MAX_IMAGE_BYTES,
  normalizeImageUnderstandingRequest,
  publicImageUnderstandingConfig
} = require("../images/analysis");
const {
  buildImageUnderstandingRequest
} = require("../images/providers/openai");
const {
  buildFileAwareIndexHtml,
  IMAGES_NAV_LINK
} = require("../files/routes");
const {
  CAPABILITY_CATALOG,
  buildCapabilityAccess
} = require("../access/entitlements");
const { getRateLimitPolicy } = require("../security/rate-limit");

function expectCode(fn, code) {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `Expected ${code} to be thrown.`);
  assert.strictEqual(thrown.code, code);
  return thrown;
}

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function main() {
  // A real 1x1 PNG; plain text must be rejected by upload protection.
  const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const normalized = normalizeImageUnderstandingRequest({
    filename: "screenshot.png",
    imageBase64,
    prompt: "Read the visible error and explain it.",
    detail: "high"
  });
  assert.strictEqual(normalized.filename, "screenshot.png");
  assert.strictEqual(normalized.mimeType, "image/png");
  assert.strictEqual(normalized.detail, "high");
  assert.strictEqual(normalized.imageBase64, imageBase64);

  expectCode(
    () => normalizeImageUnderstandingRequest({ filename: "../secret.png", imageBase64 }),
    "IMAGE_UNDERSTANDING_FILENAME_INVALID"
  );
  expectCode(
    () => normalizeImageUnderstandingRequest({ filename: "payload.svg", imageBase64 }),
    "IMAGE_UNDERSTANDING_TYPE_UNSUPPORTED"
  );
  expectCode(
    () => normalizeImageUnderstandingRequest({ filename: "image.png", imageBase64: `data:image/png;base64,${imageBase64}` }),
    "IMAGE_UNDERSTANDING_DATA_INVALID"
  );

  const tooLarge = Buffer.alloc(64 * 1024 + 1, 1).toString("base64");
  const tooLargeError = expectCode(
    () => normalizeImageUnderstandingRequest(
      { filename: "large.png", imageBase64: tooLarge },
      { IMAGE_UNDERSTANDING_MAX_BYTES: String(64 * 1024) }
    ),
    "IMAGE_UNDERSTANDING_IMAGE_TOO_LARGE"
  );
  assert.strictEqual(tooLargeError.statusCode, 413);

  const limits = publicImageUnderstandingConfig({});
  assert.strictEqual(limits.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES);
  assert.strictEqual(limits.rawImagesStoredByUnbound, false);
  assert.strictEqual(limits.providerResponseStorageRequested, false);
  assert.ok(limits.acceptedExtensions.includes(".png"));
  assert.ok(limits.acceptedExtensions.includes(".jpg"));
  assert.ok(limits.acceptedExtensions.includes(".webp"));

  const request = buildImageUnderstandingRequest({
    mimeType: normalized.mimeType,
    imageBase64: normalized.imageBase64,
    prompt: normalized.prompt,
    detail: normalized.detail,
    model: "test-model",
    env: {}
  });
  assert.strictEqual(request.model, "test-model");
  assert.strictEqual(request.store, false);
  assert.ok(request.instructions.includes("untrusted user-provided data"));
  const imagePart = request.input[0].content.find((item) => item.type === "input_image");
  const textPart = request.input[0].content.find((item) => item.type === "input_text");
  assert.ok(imagePart.image_url.startsWith("data:image/png;base64,"));
  assert.ok(imagePart.image_url.endsWith(imageBase64));
  assert.strictEqual(imagePart.detail, "high");
  assert.strictEqual(textPart.text, "Read the visible error and explain it.");

  assert.strictEqual(CAPABILITY_CATALOG.image_understanding.implemented, true);
  assert.strictEqual(CAPABILITY_CATALOG.image_understanding.minimumPlan, "premium");
  assert.strictEqual(CAPABILITY_CATALOG.image_tools.implemented, true);
  const freeImage = buildCapabilityAccess({ planTier: "free" }).find((item) => item.key === "image_understanding");
  const premiumImage = buildCapabilityAccess({ planTier: "premium" }).find((item) => item.key === "image_understanding");
  const legacyTopImage = buildCapabilityAccess({ planTier: "top" }).find((item) => item.key === "image_understanding");
  assert.strictEqual(freeImage.usable, false);
  assert.strictEqual(premiumImage.usable, true);
  assert.strictEqual(legacyTopImage.usable, true);

  const rate = getRateLimitPolicy({}).imageUnderstanding;
  assert.strictEqual(rate.scope, "image_understanding_account");
  assert.strictEqual(rate.limit, 30);
  assert.strictEqual(rate.windowSeconds, 60 * 60);

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const composed = buildFileAwareIndexHtml(indexSource);
  assert.strictEqual(count(composed, IMAGES_NAV_LINK), 1);
  assert.strictEqual(count(composed, '<script src="/email-account-ui.js" defer></script>'), 1);

  console.log("UNBOUND AI image-understanding contract checks passed: Premium entitlement with legacy TOP compatibility.");
}

main();
