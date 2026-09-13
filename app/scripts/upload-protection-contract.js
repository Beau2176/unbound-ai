const assert = require("assert");
const {
  inspectUpload,
  assertUploadSafe
} = require("../security/upload-protection");
const { normalizeFileAnalysisRequest } = require("../files/analysis");
const { normalizeImageUnderstandingRequest } = require("../images/analysis");
const { normalizeEditRequest } = require("../images/tools");

function expectRejected(fn, code) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, "Expected upload to be rejected");
  assert.strictEqual(thrown.code, code);
}

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x00]);
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n", "ascii");
const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
const fakeZipWithMacro = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("word/vbaProject.bin", "latin1")
]);

assert.strictEqual(inspectUpload({ filename: "safe.png", buffer: png, kind: "image" }).safe, true);
assert.strictEqual(inspectUpload({ filename: "safe.pdf", buffer: pdf, kind: "file" }).safe, true);
assert.strictEqual(inspectUpload({ filename: "fake.png", buffer: executable, kind: "image" }).safe, false);
assert.strictEqual(inspectUpload({ filename: "wrong.jpg", buffer: png, kind: "image" }).reason, "image_signature_mismatch");
assert.strictEqual(inspectUpload({ filename: "macro.docx", buffer: fakeZipWithMacro, kind: "file" }).reason, "office_macro_content");

expectRejected(
  () => assertUploadSafe({ filename: "malware.pdf", buffer: executable, kind: "file" }),
  "UPLOAD_SECURITY_REJECTED"
);

const safeFile = normalizeFileAnalysisRequest({
  filename: "report.pdf",
  fileBase64: pdf.toString("base64"),
  prompt: "Summarize it"
});
assert.strictEqual(safeFile.mimeType, "application/pdf");

expectRejected(
  () => normalizeFileAnalysisRequest({
    filename: "report.pdf",
    fileBase64: executable.toString("base64")
  }),
  "FILE_ANALYSIS_SECURITY_REJECTED"
);

const safeImage = normalizeImageUnderstandingRequest({
  filename: "photo.jpg",
  imageBase64: jpeg.toString("base64")
});
assert.strictEqual(safeImage.mimeType, "image/jpeg");

expectRejected(
  () => normalizeImageUnderstandingRequest({
    filename: "photo.jpg",
    imageBase64: executable.toString("base64")
  }),
  "IMAGE_UNDERSTANDING_SECURITY_REJECTED"
);

const safeEdit = normalizeEditRequest({
  filename: "edit.png",
  imageBase64: png.toString("base64"),
  prompt: "Make it brighter"
});
assert.strictEqual(safeEdit.mimeType, "image/png");

expectRejected(
  () => normalizeEditRequest({
    filename: "edit.png",
    imageBase64: executable.toString("base64"),
    prompt: "Edit it"
  }),
  "IMAGE_TOOL_EDIT_SECURITY_REJECTED"
);

console.log("upload-protection-contract: ok");
