const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  normalizePlanRequest,
  normalizeArtifactSpec,
  extractJsonObject,
  buildPlannerInstructions,
  safeArtifactFilename
} = require("../artifacts/schema");
const {
  MIME,
  crc32,
  createZip,
  generateArtifact
} = require("../artifacts/generator");
const { CAPABILITY_CATALOG } = require("../access/entitlements");
const { getRateLimitPolicy } = require("../security/rate-limit");
const { publicPlatformCatalog } = require("../platform/registry");

function zipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    assert.strictEqual(method, 0, "Artifact ZIP entries must use bounded store mode.");
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");
    entries.set(name, buffer.subarray(dataStart, dataEnd));
    offset = dataEnd;
  }
  return entries;
}

async function main() {
  assert.strictEqual(crc32(Buffer.from("123456789")), 0xcbf43926);
  const smallZip = createZip([{ name: "hello.txt", data: "hello" }]);
  assert.strictEqual(smallZip.readUInt32LE(0), 0x04034b50);
  assert.strictEqual(zipEntries(smallZip).get("hello.txt").toString("utf8"), "hello");

  const request = normalizePlanRequest({
    type: "document",
    title: "Launch Plan",
    prompt: "Create a launch plan with milestones and risks."
  });
  assert.deepStrictEqual(request, {
    type: "document",
    title: "Launch Plan",
    prompt: "Create a launch plan with milestones and risks."
  });
  assert.throws(() => normalizePlanRequest({ type: "script", prompt: "x" }), /Choose document/);
  assert.throws(() => normalizePlanRequest({ type: "document", prompt: "" }), /Describe what/);

  const parsed = extractJsonObject('\\n```json\\n{"type":"document","title":"A","sections":[{"heading":"H","paragraphs":["P"]}]}\\n```');
  assert.strictEqual(parsed.title, "A");
  assert(buildPlannerInstructions("document").includes("no markdown fences"));
  assert(buildPlannerInstructions("spreadsheet").includes('"sheets"'));
  assert(buildPlannerInstructions("presentation").includes('"slides"'));
  assert.strictEqual(safeArtifactFilename("../Unsafe Name", "docx"), "Unsafe-Name.docx");

  const docSpec = normalizeArtifactSpec({
    type: "document",
    title: "UNBOUND Test Document",
    sections: [
      { heading: "Summary", paragraphs: ["First paragraph."], bullets: ["One", "Two"] },
      { heading: "Next Steps", paragraphs: ["Ship it."] }
    ]
  });
  const doc = await generateArtifact(docSpec);
  assert.strictEqual(doc.mimeType, MIME.document);
  assert(doc.filename.endsWith(".docx"));
  const docEntries = zipEntries(doc.buffer);
  for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) {
    assert(docEntries.has(name), "DOCX missing " + name);
  }
  const wordXml = docEntries.get("word/document.xml").toString("utf8");
  assert(wordXml.includes("UNBOUND Test Document"));
  assert(wordXml.includes("Next Steps"));
  assert.strictEqual([...docEntries.keys()].some((name) => /vbaProject|macros/i.test(name)), false);

  const sheetSpec = normalizeArtifactSpec({
    type: "spreadsheet",
    title: "UNBOUND Test Workbook",
    sheets: [{
      name: "Budget",
      columns: ["Item", "Amount", "Paid"],
      rows: [["Hosting", 25.5, true], ["AI", 100, false]]
    }]
  });
  const xlsx = await generateArtifact(sheetSpec);
  assert.strictEqual(xlsx.mimeType, MIME.spreadsheet);
  const xlsxEntries = zipEntries(xlsx.buffer);
  for (const name of [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml"
  ]) {
    assert(xlsxEntries.has(name), "XLSX missing " + name);
  }
  const sheetXml = xlsxEntries.get("xl/worksheets/sheet1.xml").toString("utf8");
  assert(sheetXml.includes("Hosting"));
  assert(sheetXml.includes("<v>25.5</v>"));
  assert.strictEqual([...xlsxEntries.keys()].some((name) => /vbaProject|macros/i.test(name)), false);

  const presentationSpec = normalizeArtifactSpec({
    type: "presentation",
    title: "UNBOUND Test Deck",
    subtitle: "Artifact Studio",
    slides: [
      { title: "Why Now", bullets: ["Faster creation", "Real Office files"], notes: "Speaker context" },
      { title: "Next Step", bullets: ["Launch"] }
    ]
  });
  const pptx = await generateArtifact(presentationSpec);
  assert.strictEqual(pptx.mimeType, MIME.presentation);
  const pptEntries = zipEntries(pptx.buffer);
  for (const name of [
    "[Content_Types].xml",
    "_rels/.rels",
    "ppt/presentation.xml",
    "ppt/_rels/presentation.xml.rels",
    "ppt/slideMasters/slideMaster1.xml",
    "ppt/slideLayouts/slideLayout1.xml",
    "ppt/theme/theme1.xml",
    "ppt/slides/slide1.xml",
    "ppt/slides/slide2.xml",
    "ppt/slides/slide3.xml"
  ]) {
    assert(pptEntries.has(name), "PPTX missing " + name);
  }
  assert(pptEntries.get("ppt/slides/slide1.xml").toString("utf8").includes("UNBOUND Test Deck"));
  assert(pptEntries.get("ppt/slides/slide2.xml").toString("utf8").includes("Faster creation"));
  assert.strictEqual([...pptEntries.keys()].some((name) => /vbaProject|macros/i.test(name)), false);

  assert(CAPABILITY_CATALOG.artifact_creation);
  assert.strictEqual(CAPABILITY_CATALOG.artifact_creation.implemented, true);
  assert.strictEqual(CAPABILITY_CATALOG.artifact_creation.minimumPlan, "premium");

  const rate = getRateLimitPolicy({});
  assert(rate.artifacts);
  assert.strictEqual(rate.artifacts.scope, "artifact_account");
  assert.strictEqual(rate.artifacts.limit, 30);

  const platform = publicPlatformCatalog({});
  const artifactSkill = platform.skills.find((item) => item.id === "documents");
  assert(artifactSkill.tools.includes("artifact_creation"));
  assert.strictEqual(platform.workspace.artifactStudio, true);
  assert.deepStrictEqual(platform.workspace.artifactExports, ["docx", "xlsx", "pptx"]);

  const routes = fs.readFileSync(path.join(__dirname, "..", "artifacts", "routes.js"), "utf8");
  assert(routes.includes('router.post("/plan"'));
  assert(routes.includes('router.post("/export"'));
  assert(routes.includes("generateChat({"));
  assert(routes.includes("normalizeArtifactSpec"));
  assert(routes.includes("MAX_EXPORT_BYTES"));
  assert(!routes.includes("child_process"));
  assert(!routes.includes("eval("));

  const page = fs.readFileSync(path.join(__dirname, "..", "artifact-studio.html"), "utf8");
  assert(page.includes("Artifact Studio"));
  assert(page.includes("/api/artifacts/plan"));
  assert(page.includes("/api/artifacts/export"));
  assert(page.includes("DOCX"));
  assert(page.includes("XLSX"));
  assert(page.includes("PPTX"));
  assert(page.includes("@media (max-width:760px)"));

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.strictEqual(Boolean(packageJson.dependencies.docx), false);
  assert.strictEqual(Boolean(packageJson.dependencies.exceljs), false);
  assert.strictEqual(Boolean(packageJson.dependencies.pptxgenjs), false);

  console.log("PASS Artifact Studio: bounded AI planning, dependency-free OOXML DOCX/XLSX/PPTX exports, Premium entitlement, rate limiting, mobile UI, and macro-free packages.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
