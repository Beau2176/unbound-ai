const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DEFAULT_MAX_EDIT_IMAGE_BYTES,
  normalizeGenerateRequest,
  normalizeEditRequest,
  publicImageToolsConfig
} = require("../images/tools");
const {
  DEFAULT_IMAGE_MODEL,
  buildImageGenerationRequest,
  buildImageEditRequest,
  extractGeneratedImage
} = require("../images/providers/openai");
const {
  CAPABILITY_CATALOG,
  buildCapabilityAccess
} = require("../access/entitlements");
const { getRateLimitPolicy } = require("../security/rate-limit");
const {
  IMAGE_STUDIO_NAV_LINK,
  buildFileAwareIndexHtml
} = require("../files/routes");

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
  const generated = normalizeGenerateRequest({
    prompt: "A glowing blue-and-gold infinity symbol above a mountain sunrise",
    size: "1536x1024",
    quality: "high",
    background: "transparent",
    outputFormat: "jpeg"
  });
  assert.strictEqual(generated.prompt.startsWith("A glowing"), true);
  assert.strictEqual(generated.size, "1536x1024");
  assert.strictEqual(generated.quality, "high");
  assert.strictEqual(generated.outputFormat, "jpeg");
  assert.strictEqual(generated.background, "opaque");

  expectCode(() => normalizeGenerateRequest({ prompt: "" }), "IMAGE_TOOL_PROMPT_REQUIRED");

  const imageBase64 = Buffer.from("UNBOUND EDIT TEST", "utf8").toString("base64");
  const edited = normalizeEditRequest({
    filename: "source.png",
    imageBase64,
    prompt: "Replace the background with a mountain sunrise.",
    inputFidelity: "high",
    outputFormat: "png"
  });
  assert.strictEqual(edited.filename, "source.png");
  assert.strictEqual(edited.mimeType, "image/png");
  assert.strictEqual(edited.inputFidelity, "high");
  assert.ok(Buffer.isBuffer(edited.imageBuffer));
  assert.strictEqual(edited.imageBytes, Buffer.from(imageBase64, "base64").length);

  expectCode(
    () => normalizeEditRequest({ filename: "../source.png", imageBase64, prompt: "edit" }),
    "IMAGE_TOOL_EDIT_FILENAME_INVALID"
  );
  expectCode(
    () => normalizeEditRequest({ filename: "source.svg", imageBase64, prompt: "edit" }),
    "IMAGE_TOOL_EDIT_TYPE_UNSUPPORTED"
  );
  expectCode(
    () => normalizeEditRequest({ filename: "source.png", imageBase64: `data:image/png;base64,${imageBase64}`, prompt: "edit" }),
    "IMAGE_TOOL_EDIT_DATA_INVALID"
  );

  const tooLarge = Buffer.alloc(64 * 1024 + 1, 1).toString("base64");
  const tooLargeError = expectCode(
    () => normalizeEditRequest(
      { filename: "large.png", imageBase64: tooLarge, prompt: "edit" },
      { IMAGE_TOOLS_MAX_EDIT_BYTES: String(64 * 1024) }
    ),
    "IMAGE_TOOL_EDIT_IMAGE_TOO_LARGE"
  );
  assert.strictEqual(tooLargeError.statusCode, 413);

  const limits = publicImageToolsConfig({});
  assert.strictEqual(limits.maxEditImageBytes, DEFAULT_MAX_EDIT_IMAGE_BYTES);
  assert.strictEqual(limits.oneImagePerRequest, true);
  assert.strictEqual(limits.generatedImagesStoredByUnbound, false);
  assert.strictEqual(limits.rawEditImagesStoredByUnbound, false);
  assert.ok(!limits.allowedQualities.includes("xhigh"));
  assert.ok(!limits.allowedQualities.includes("max"));

  const generationRequest = buildImageGenerationRequest({
    prompt: generated.prompt,
    size: generated.size,
    quality: generated.quality,
    background: generated.background,
    outputFormat: generated.outputFormat,
    env: {}
  });
  assert.strictEqual(generationRequest.model, DEFAULT_IMAGE_MODEL);
  assert.strictEqual(generationRequest.n, 1);
  assert.strictEqual(generationRequest.moderation, "auto");
  assert.strictEqual(generationRequest.output_format, "jpeg");

  const editRequest = buildImageEditRequest({
    prompt: edited.prompt,
    inputFidelity: edited.inputFidelity,
    outputFormat: edited.outputFormat,
    env: {}
  });
  assert.strictEqual(editRequest.model, DEFAULT_IMAGE_MODEL);
  assert.strictEqual(editRequest.n, 1);
  assert.strictEqual(editRequest.input_fidelity, "high");

  const extracted = extractGeneratedImage(
    { data: [{ b64_json: "YWJj" }], usage: { total_tokens: 12 } },
    { outputFormat: "png", size: "1024x1024", quality: "medium", background: "auto" }
  );
  assert.strictEqual(extracted.imageBase64, "YWJj");
  assert.strictEqual(extracted.outputFormat, "png");
  expectCode(() => extractGeneratedImage({ data: [] }), "IMAGE_PROVIDER_EMPTY_OUTPUT");

  assert.strictEqual(CAPABILITY_CATALOG.image_tools.implemented, true);
  assert.strictEqual(CAPABILITY_CATALOG.image_tools.minimumPlan, "top");
  const free = buildCapabilityAccess({ planTier: "free" }).find((item) => item.key === "image_tools");
  const top = buildCapabilityAccess({ planTier: "top" }).find((item) => item.key === "image_tools");
  assert.strictEqual(free.usable, false);
  assert.strictEqual(top.usable, true);

  const rate = getRateLimitPolicy({}).imageTools;
  assert.strictEqual(rate.scope, "image_tools_account");
  assert.strictEqual(rate.limit, 20);
  assert.strictEqual(rate.windowSeconds, 60 * 60);

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const composed = buildFileAwareIndexHtml(indexSource);
  assert.strictEqual(count(composed, IMAGE_STUDIO_NAV_LINK), 1);

  const studio = fs.readFileSync(path.join(__dirname, "..", "image-tools.html"), "utf8");
  assert.ok(studio.includes("The configured image provider's normal content moderation remains enabled"));
  assert.ok(studio.includes("one result is produced per request") || studio.includes("One result is produced per request"));
  assert.ok(!studio.includes('value="xhigh"'));
  assert.ok(!studio.includes('value="max"'));

  const routes = fs.readFileSync(path.join(__dirname, "..", "images", "tools-routes.js"), "utf8");
  assert.ok(routes.includes("estimatedCostMicros: null"));
  assert.ok(routes.includes('eventType: "image_generation"'));
  assert.ok(routes.includes('eventType: "image_edit"'));

  console.log("UNBOUND AI image-tools contract checks passed.");
}

main();
