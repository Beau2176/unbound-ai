const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  DEFAULT_MAX_FILE_BYTES,
  normalizeFileAnalysisRequest,
  publicFileAnalysisConfig
} = require("../files/analysis");
const {
  buildFileAnalysisRequest
} = require("../ai/providers/openai");
const {
  buildFileAwareIndexHtml,
  FILES_NAV_LINK
} = require("../files/routes");
const {
  CAPABILITY_CATALOG,
  buildCapabilityAccess
} = require("../access/entitlements");
const { getRateLimitPolicy } = require("../security/rate-limit");

function expectCode(fn, code) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `Expected ${code} to be thrown.`);
  assert.strictEqual(thrown.code, code);
  return thrown;
}

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function main() {
  const pdfBase64 = Buffer.from("%PDF-1.4\nUNBOUND FILE ANALYSIS TEST\n", "utf8").toString("base64");
  const normalized = normalizeFileAnalysisRequest({
    filename: "review.pdf",
    fileBase64: pdfBase64,
    prompt: "Summarize the document.",
    detail: "high"
  });

  assert.strictEqual(normalized.filename, "review.pdf");
  assert.strictEqual(normalized.mimeType, "application/pdf");
  assert.strictEqual(normalized.detail, "high");
  assert.strictEqual(normalized.fileBase64, pdfBase64);
  assert.strictEqual(normalized.fileBytes, Buffer.from(pdfBase64, "base64").length);

  expectCode(
    () => normalizeFileAnalysisRequest({ filename: "../secret.pdf", fileBase64: pdfBase64 }),
    "FILE_ANALYSIS_FILENAME_INVALID"
  );
  expectCode(
    () => normalizeFileAnalysisRequest({ filename: "payload.exe", fileBase64: pdfBase64 }),
    "FILE_ANALYSIS_TYPE_UNSUPPORTED"
  );
  expectCode(
    () => normalizeFileAnalysisRequest({
      filename: "review.pdf",
      fileBase64: `data:application/pdf;base64,${pdfBase64}`
    }),
    "FILE_ANALYSIS_DATA_INVALID"
  );

  const tooLarge = Buffer.alloc(64 * 1024 + 1, 1).toString("base64");
  const tooLargeError = expectCode(
    () => normalizeFileAnalysisRequest(
      { filename: "large.pdf", fileBase64: tooLarge },
      { FILE_ANALYSIS_MAX_BYTES: String(64 * 1024) }
    ),
    "FILE_ANALYSIS_FILE_TOO_LARGE"
  );
  assert.strictEqual(tooLargeError.statusCode, 413);

  const publicLimits = publicFileAnalysisConfig({});
  assert.strictEqual(publicLimits.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  assert.strictEqual(publicLimits.rawFilesStoredByUnbound, false);
  assert.strictEqual(publicLimits.providerResponseStorageRequested, false);
  assert.ok(publicLimits.acceptedExtensions.includes(".pdf"));

  const providerRequest = buildFileAnalysisRequest({
    filename: normalized.filename,
    mimeType: normalized.mimeType,
    fileBase64: normalized.fileBase64,
    prompt: normalized.prompt,
    detail: normalized.detail,
    model: "test-model"
  });
  assert.strictEqual(providerRequest.model, "test-model");
  assert.strictEqual(providerRequest.store, false);
  assert.ok(providerRequest.instructions.includes("untrusted data"));
  const filePart = providerRequest.input[0].content.find((item) => item.type === "input_file");
  const textPart = providerRequest.input[0].content.find((item) => item.type === "input_text");
  assert.ok(filePart);
  assert.ok(filePart.file_data.startsWith("data:application/pdf;base64,"));
  assert.ok(filePart.file_data.endsWith(pdfBase64));
  assert.strictEqual(filePart.filename, "review.pdf");
  assert.strictEqual(filePart.detail, "high");
  assert.strictEqual(textPart.text, "Summarize the document.");

  assert.strictEqual(CAPABILITY_CATALOG.file_analysis.implemented, true);
  assert.strictEqual(CAPABILITY_CATALOG.file_analysis.minimumPlan, "top");
  const freeFile = buildCapabilityAccess({ planTier: "free" })
    .find((item) => item.key === "file_analysis");
  const topFile = buildCapabilityAccess({ planTier: "top" })
    .find((item) => item.key === "file_analysis");
  assert.strictEqual(freeFile.usable, false);
  assert.strictEqual(topFile.usable, true);

  const fileRate = getRateLimitPolicy({}).fileAnalysis;
  assert.strictEqual(fileRate.scope, "file_analysis_account");
  assert.strictEqual(fileRate.limit, 30);
  assert.strictEqual(fileRate.windowSeconds, 60 * 60);

  const indexPath = path.join(__dirname, "..", "index.html");
  const indexSource = fs.readFileSync(indexPath, "utf8");
  const composedIndex = buildFileAwareIndexHtml(indexSource);
  assert.strictEqual(count(composedIndex, FILES_NAV_LINK), 1);
  assert.strictEqual(count(composedIndex, '<script src="/email-account-ui.js" defer></script>'), 1);
  assert.ok(composedIndex.includes("A more open tomorrow starts today."));

  console.log("UNBOUND AI file-analysis contract checks passed.");
}

main();
