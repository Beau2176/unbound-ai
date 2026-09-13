const path = require("path");

const EXECUTABLE_MAGIC = Object.freeze([
  { name: "Windows executable", bytes: Buffer.from([0x4d, 0x5a]) },
  { name: "ELF executable", bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
  { name: "Mach-O executable", bytes: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]) },
  { name: "Mach-O executable", bytes: Buffer.from([0xfe, 0xed, 0xfa, 0xcf]) },
  { name: "Mach-O executable", bytes: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) }
]);

const DANGEROUS_EXTENSIONS = Object.freeze(new Set([
  ".exe", ".dll", ".com", ".scr", ".msi", ".msp", ".cpl", ".sys",
  ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse",
  ".wsf", ".wsh", ".hta", ".reg", ".lnk", ".scf", ".jar", ".app",
  ".dmg", ".pkg", ".sh", ".bash", ".zsh", ".fish", ".py", ".pl",
  ".rb", ".php"
]));

const ARCHIVE_ACTIVE_MARKERS = Object.freeze([
  ".exe", ".dll", ".com", ".scr", ".msi", ".bat", ".cmd", ".ps1",
  ".vbs", ".vbe", ".js", ".jse", ".wsf", ".hta", ".lnk", ".jar"
]);

function uploadSecurityError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.publicMessage = message;
  error.statusCode = 400;
  return error;
}

function startsWith(buffer, signature) {
  return Buffer.isBuffer(buffer) &&
    buffer.length >= signature.length &&
    buffer.subarray(0, signature.length).equals(signature);
}

function hasExecutableMagic(buffer) {
  return EXECUTABLE_MAGIC.find((entry) => startsWith(buffer, entry.bytes)) || null;
}

function hasScriptShebang(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return false;
  const prefix = buffer.subarray(0, Math.min(buffer.length, 128)).toString("utf8");
  return /^#!\s*\/.*\b(?:sh|bash|zsh|fish|python|python3|perl|ruby|node|deno|php)\b/i.test(prefix);
}

function looksLikePdf(buffer) {
  return startsWith(buffer, Buffer.from("%PDF-", "ascii"));
}

function looksLikeRtf(buffer) {
  return startsWith(buffer, Buffer.from("{\\rtf", "ascii"));
}

function looksLikeOle(buffer) {
  return startsWith(buffer, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
}

function looksLikeZip(buffer) {
  return (
    startsWith(buffer, Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    startsWith(buffer, Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    startsWith(buffer, Buffer.from([0x50, 0x4b, 0x07, 0x08]))
  );
}

function looksLikePng(buffer) {
  return startsWith(buffer, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function looksLikeJpeg(buffer) {
  return startsWith(buffer, Buffer.from([0xff, 0xd8, 0xff]));
}

function looksLikeGif(buffer) {
  return startsWith(buffer, Buffer.from("GIF87a", "ascii")) ||
    startsWith(buffer, Buffer.from("GIF89a", "ascii"));
}

function looksLikeWebp(buffer) {
  return Buffer.isBuffer(buffer) &&
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

function lowerLatinSample(buffer, maxBytes = 2 * 1024 * 1024) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return "";
  return buffer.subarray(0, Math.min(buffer.length, maxBytes)).toString("latin1").toLowerCase();
}

function containsOfficeMacroMarker(buffer) {
  const sample = lowerLatinSample(buffer);
  return sample.includes("vbaproject.bin") ||
    sample.includes("_vba_project") ||
    sample.includes("macros/vba");
}

function containsArchiveActivePayload(buffer) {
  if (!looksLikeZip(buffer)) return false;
  const sample = lowerLatinSample(buffer);
  return ARCHIVE_ACTIVE_MARKERS.some((extension) => {
    const escaped = extension.replace(".", "\\.");
    return new RegExp(`${escaped}(?:[\\x00\\s\\/\\\\]|$)`, "i").test(sample);
  });
}

function containsPdfActiveContent(buffer) {
  if (!looksLikePdf(buffer)) return false;
  const sample = lowerLatinSample(buffer);
  return [
    "/javascript",
    "/js ",
    "/js<",
    "/launch",
    "/embeddedfile",
    "/openaction",
    "/richmedia"
  ].some((marker) => sample.includes(marker));
}

function containsRtfActiveContent(buffer) {
  if (!looksLikeRtf(buffer)) return false;
  const sample = lowerLatinSample(buffer);
  return sample.includes("\\object") ||
    sample.includes("\\objdata") ||
    sample.includes("\\objemb") ||
    sample.includes("\\objlink");
}

function containsHtmlActiveContent(buffer) {
  const sample = lowerLatinSample(buffer, 512 * 1024);
  return /<\s*(?:script|iframe|object|embed|applet)\b/i.test(sample) ||
    /\bon(?:load|error|click|mouseover|focus|submit)\s*=/i.test(sample) ||
    /\bjavascript\s*:/i.test(sample);
}

function filenameHasDangerousExtension(filename) {
  const lower = String(filename || "").trim().toLowerCase();
  if (!lower) return false;
  const basename = path.basename(lower);
  const parts = basename.split(".");
  if (parts.length < 2) return false;
  return parts.slice(1).some((part) => DANGEROUS_EXTENSIONS.has(`.${part}`));
}

function validateImageMagic(buffer, extension) {
  if (extension === ".png" && !looksLikePng(buffer)) return false;
  if ([".jpg", ".jpeg"].includes(extension) && !looksLikeJpeg(buffer)) return false;
  if (extension === ".gif" && !looksLikeGif(buffer)) return false;
  if (extension === ".webp" && !looksLikeWebp(buffer)) return false;
  return true;
}

function validateDocumentMagic(buffer, extension) {
  if (extension === ".pdf") return looksLikePdf(buffer);
  if (extension === ".rtf") return looksLikeRtf(buffer);
  if ([".doc", ".xls", ".ppt"].includes(extension)) return looksLikeOle(buffer);
  if ([".docx", ".xlsx", ".pptx", ".odt"].includes(extension)) return looksLikeZip(buffer);
  return true;
}

function inspectUpload({ filename, buffer, kind = "file" } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { safe: false, reason: "empty_or_invalid_buffer" };
  }

  const extension = path.extname(String(filename || "")).toLowerCase();
  if (filenameHasDangerousExtension(filename)) {
    return { safe: false, reason: "dangerous_filename_extension" };
  }

  const executable = hasExecutableMagic(buffer);
  if (executable) {
    return { safe: false, reason: "executable_signature", detail: executable.name };
  }

  if (hasScriptShebang(buffer)) {
    return { safe: false, reason: "script_signature" };
  }

  if (kind === "image" && !validateImageMagic(buffer, extension)) {
    return { safe: false, reason: "image_signature_mismatch" };
  }

  if (kind === "file" && !validateDocumentMagic(buffer, extension)) {
    return { safe: false, reason: "document_signature_mismatch" };
  }

  if ([".docx", ".xlsx", ".pptx", ".odt"].includes(extension)) {
    if (containsOfficeMacroMarker(buffer)) {
      return { safe: false, reason: "office_macro_content" };
    }
    if (containsArchiveActivePayload(buffer)) {
      return { safe: false, reason: "archive_active_content" };
    }
  }

  if (extension === ".pdf" && containsPdfActiveContent(buffer)) {
    return { safe: false, reason: "pdf_active_content" };
  }

  if (extension === ".rtf" && containsRtfActiveContent(buffer)) {
    return { safe: false, reason: "rtf_active_content" };
  }

  if (extension === ".html" && containsHtmlActiveContent(buffer)) {
    return { safe: false, reason: "html_active_content" };
  }

  if ([".txt", ".md", ".json", ".html", ".xml", ".csv", ".tsv"].includes(extension)) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024));
    if (sample.includes(0x00)) {
      return { safe: false, reason: "binary_content_in_text_file" };
    }
  }

  return { safe: true, reason: null };
}

function assertUploadSafe(input) {
  const result = inspectUpload(input);
  if (result.safe) return result;

  const messages = {
    dangerous_filename_extension: "That filename contains a program or script extension and was blocked.",
    executable_signature: "That upload appears to contain executable program data and was blocked.",
    script_signature: "That upload appears to contain an executable script and was blocked.",
    image_signature_mismatch: "The uploaded image does not match its file type and was blocked.",
    document_signature_mismatch: "The uploaded document does not match its file type and was blocked.",
    office_macro_content: "Macro-enabled office content is not accepted for analysis.",
    archive_active_content: "That office/archive upload appears to contain executable or script content and was blocked.",
    pdf_active_content: "PDFs containing active, embedded, or launch content are not accepted for analysis.",
    rtf_active_content: "RTF files containing embedded or linked objects are not accepted for analysis.",
    html_active_content: "HTML containing active script or embedded content is not accepted for analysis.",
    binary_content_in_text_file: "That text file contains unexpected binary data and was blocked.",
    empty_or_invalid_buffer: "The uploaded data could not be safely inspected."
  };

  throw uploadSecurityError(
    "UPLOAD_SECURITY_REJECTED",
    messages[result.reason] || "The uploaded file was blocked by UNBOUND AI upload protection."
  );
}

module.exports = {
  DANGEROUS_EXTENSIONS,
  ARCHIVE_ACTIVE_MARKERS,
  inspectUpload,
  assertUploadSafe,
  uploadSecurityError,
  validateImageMagic,
  validateDocumentMagic,
  containsOfficeMacroMarker,
  containsArchiveActivePayload,
  containsPdfActiveContent,
  containsRtfActiveContent,
  containsHtmlActiveContent,
  filenameHasDangerousExtension
};
