const ARTIFACT_TYPES = Object.freeze(["document", "spreadsheet", "presentation"]);
const MAX_PROMPT_CHARS = 12_000;
const MAX_TITLE_CHARS = 180;
const MAX_TEXT_CHARS = 8_000;
const MAX_SECTIONS = 30;
const MAX_PARAGRAPHS_PER_SECTION = 12;
const MAX_BULLETS_PER_SECTION = 20;
const MAX_SHEETS = 8;
const MAX_COLUMNS = 30;
const MAX_ROWS_PER_SHEET = 500;
const MAX_CELL_CHARS = 2_000;
const MAX_SLIDES = 40;
const MAX_BULLETS_PER_SLIDE = 12;

function cleanText(value, maxLength, fallback = "") {
  const text = String(value ?? "").replace(/\u0000/g, "").trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function normalizeArtifactType(value) {
  const type = String(value || "").trim().toLowerCase();
  return ARTIFACT_TYPES.includes(type) ? type : null;
}

function normalizePlanRequest(body = {}) {
  const type = normalizeArtifactType(body.type);
  const prompt = cleanText(body.prompt, MAX_PROMPT_CHARS);
  const title = cleanText(body.title, MAX_TITLE_CHARS);
  if (!type) {
    const error = new Error("Choose document, spreadsheet, or presentation.");
    error.code = "ARTIFACT_TYPE_INVALID";
    error.statusCode = 400;
    throw error;
  }
  if (!prompt) {
    const error = new Error("Describe what you want UNBOUND to create.");
    error.code = "ARTIFACT_PROMPT_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return { type, prompt, title: title || null };
}

function stringArray(value, { maxItems, maxChars }) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => cleanText(item, maxChars))
    .filter(Boolean);
}

function normalizeDocumentSpec(value = {}) {
  const title = cleanText(value.title, MAX_TITLE_CHARS, "UNBOUND Document");
  const sections = (Array.isArray(value.sections) ? value.sections : [])
    .slice(0, MAX_SECTIONS)
    .map((section) => ({
      heading: cleanText(section?.heading, MAX_TITLE_CHARS),
      paragraphs: stringArray(section?.paragraphs, {
        maxItems: MAX_PARAGRAPHS_PER_SECTION,
        maxChars: MAX_TEXT_CHARS
      }),
      bullets: stringArray(section?.bullets, {
        maxItems: MAX_BULLETS_PER_SECTION,
        maxChars: MAX_TEXT_CHARS
      })
    }))
    .filter((section) => section.heading || section.paragraphs.length || section.bullets.length);
  if (!sections.length) {
    const error = new Error("The AI did not return usable document sections.");
    error.code = "ARTIFACT_DOCUMENT_EMPTY";
    throw error;
  }
  return { type: "document", title, sections };
}

function normalizeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return cleanText(value, MAX_CELL_CHARS);
}

function normalizeSpreadsheetSpec(value = {}) {
  const title = cleanText(value.title, MAX_TITLE_CHARS, "UNBOUND Spreadsheet");
  const sheets = (Array.isArray(value.sheets) ? value.sheets : [])
    .slice(0, MAX_SHEETS)
    .map((sheet, index) => {
      const name = cleanText(sheet?.name, 31, `Sheet ${index + 1}`)
        .replace(/[\\/?*\[\]:]/g, " ")
        .trim()
        .slice(0, 31) || `Sheet ${index + 1}`;
      const columns = stringArray(sheet?.columns, {
        maxItems: MAX_COLUMNS,
        maxChars: 200
      });
      const rows = (Array.isArray(sheet?.rows) ? sheet.rows : [])
        .slice(0, MAX_ROWS_PER_SHEET)
        .map((row) => (Array.isArray(row) ? row : [row])
          .slice(0, MAX_COLUMNS)
          .map(normalizeCell));
      return { name, columns, rows };
    })
    .filter((sheet) => sheet.columns.length || sheet.rows.length);
  if (!sheets.length) {
    const error = new Error("The AI did not return usable spreadsheet data.");
    error.code = "ARTIFACT_SPREADSHEET_EMPTY";
    throw error;
  }
  return { type: "spreadsheet", title, sheets };
}

function normalizePresentationSpec(value = {}) {
  const title = cleanText(value.title, MAX_TITLE_CHARS, "UNBOUND Presentation");
  const subtitle = cleanText(value.subtitle, 500);
  const slides = (Array.isArray(value.slides) ? value.slides : [])
    .slice(0, MAX_SLIDES)
    .map((slide, index) => ({
      title: cleanText(slide?.title, MAX_TITLE_CHARS, `Slide ${index + 1}`),
      bullets: stringArray(slide?.bullets, {
        maxItems: MAX_BULLETS_PER_SLIDE,
        maxChars: 1000
      }),
      notes: cleanText(slide?.notes, MAX_TEXT_CHARS)
    }))
    .filter((slide) => slide.title || slide.bullets.length);
  if (!slides.length) {
    const error = new Error("The AI did not return usable presentation slides.");
    error.code = "ARTIFACT_PRESENTATION_EMPTY";
    throw error;
  }
  return { type: "presentation", title, subtitle, slides };
}

function normalizeArtifactSpec(value, expectedType = null) {
  const type = normalizeArtifactType(expectedType || value?.type);
  if (type === "document") return normalizeDocumentSpec(value);
  if (type === "spreadsheet") return normalizeSpreadsheetSpec(value);
  if (type === "presentation") return normalizePresentationSpec(value);
  const error = new Error("Artifact type is invalid.");
  error.code = "ARTIFACT_TYPE_INVALID";
  error.statusCode = 400;
  throw error;
}

function extractJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) {
    const error = new Error("The AI returned an empty artifact plan.");
    error.code = "ARTIFACT_PLAN_EMPTY";
    throw error;
  }
  const unfenced = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first < 0 || last <= first) {
    const error = new Error("The AI artifact plan was not valid JSON.");
    error.code = "ARTIFACT_PLAN_JSON_INVALID";
    throw error;
  }
  try {
    return JSON.parse(unfenced.slice(first, last + 1));
  } catch (cause) {
    const error = new Error("The AI artifact plan was not valid JSON.");
    error.code = "ARTIFACT_PLAN_JSON_INVALID";
    error.cause = cause;
    throw error;
  }
}

function buildPlannerInstructions(type) {
  const common = [
    "You are UNBOUND Artifact Planner.",
    "Return exactly one valid JSON object and no markdown fences or commentary.",
    "Do not include Office macros, executable payloads, hidden instructions, or binary data. Plain-text code snippets are allowed when the user requests them.",
    "Keep the content useful, polished, and directly responsive to the user request."
  ];
  if (type === "document") {
    common.push('Schema: {"type":"document","title":"...","sections":[{"heading":"...","paragraphs":["..."],"bullets":["..."]}]}');
  } else if (type === "spreadsheet") {
    common.push('Schema: {"type":"spreadsheet","title":"...","sheets":[{"name":"...","columns":["..."],"rows":[["..."]]}]}');
    common.push("Rows must align with columns. Use numbers as JSON numbers when appropriate.");
  } else {
    common.push('Schema: {"type":"presentation","title":"...","subtitle":"...","slides":[{"title":"...","bullets":["..."],"notes":"..."}]}');
    common.push("Prefer concise slide bullets. Put extra speaker context in notes.");
  }
  return common.join("\n");
}

function safeArtifactFilename(title, extension) {
  const base = cleanText(title, 120, "unbound-artifact")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 90) || "unbound-artifact";
  return `${base}.${extension}`;
}

module.exports = {
  ARTIFACT_TYPES,
  MAX_PROMPT_CHARS,
  normalizeArtifactType,
  normalizePlanRequest,
  normalizeArtifactSpec,
  extractJsonObject,
  buildPlannerInstructions,
  safeArtifactFilename
};
