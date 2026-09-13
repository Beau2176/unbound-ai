const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  MODE_CATALOG,
  AI_STYLE_DEFINITIONS,
  normalizeAiStyle,
  getAiStyleDefinition,
  getAiStylePrompt,
  listAiStyles
} = require("../preferences/ai-style");
const {
  buildAiStyleOptions,
  buildAiStyleBrowserFunctions,
  buildFileAwareIndexHtml,
  LEGACY_STYLE_FUNCTIONS
} = require("../files/routes");

function main() {
  assert.strictEqual(MODE_CATALOG.length, 100);
  assert.strictEqual(Object.keys(AI_STYLE_DEFINITIONS).length, 100);
  assert.strictEqual(new Set(MODE_CATALOG.map((mode) => mode.id)).size, 100);
  assert.strictEqual(new Set(MODE_CATALOG.map((mode) => mode.label)).size, 100);

  for (const legacyId of ["balanced", "straight", "professional", "warm", "playful"]) {
    assert.ok(AI_STYLE_DEFINITIONS[legacyId], `Legacy mode ${legacyId} must remain available.`);
  }

  assert.strictEqual(normalizeAiStyle("programmer"), "programmer");
  assert.strictEqual(normalizeAiStyle("TRAVEL_PLANNER"), "travel_planner");
  assert.strictEqual(normalizeAiStyle("not-a-real-mode"), "balanced");
  assert.strictEqual(getAiStyleDefinition("programmer").label, "Programmer");
  assert.ok(getAiStylePrompt("security_defender").includes("Security Defender"));
  assert.ok(getAiStylePrompt("security_defender").includes("safety boundaries"));

  const listed = listAiStyles();
  assert.strictEqual(listed.length, 100);
  assert.deepStrictEqual(Object.keys(listed[0]).sort(), ["description", "id", "label"]);
  assert.ok(listed.some((mode) => mode.id === "entrepreneurship"));
  assert.ok(listed.some((mode) => mode.id === "medical_info"));

  const options = buildAiStyleOptions(listed);
  assert.strictEqual((options.match(/<option value=/g) || []).length, 100);
  assert.ok(options.includes('<option value="programmer">PROGRAMMER</option>'));
  assert.ok(options.includes('<option value="straight">STRAIGHT SHOOTER</option>'));

  const browserFunctions = buildAiStyleBrowserFunctions(listed);
  assert.ok(browserFunctions.includes('"programmer"'));
  assert.ok(browserFunctions.includes('"Programmer"'));
  assert.ok(browserFunctions.includes("UNBOUND_AI_STYLE_IDS"));
  new vm.Script(browserFunctions);

  const rawIndex = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const rendered = buildFileAwareIndexHtml(rawIndex);
  const selectMatch = rendered.match(/<select id="aiStyleSelect"[\s\S]*?<\/select>/);
  assert.ok(selectMatch, "Rendered homepage must contain the AI mode selector.");
  assert.strictEqual((selectMatch[0].match(/<option value=/g) || []).length, 100);
  assert.ok(selectMatch[0].includes('value="programmer"'));
  assert.ok(selectMatch[0].includes('value="medical_info"'));
  assert.ok(rendered.includes("UNBOUND_AI_STYLE_IDS"));
  assert.ok(!rendered.includes(LEGACY_STYLE_FUNCTIONS));

  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let checked = 0;
  while ((match = scriptPattern.exec(rendered))) {
    const code = String(match[1] || "").trim();
    if (!code) continue;
    new vm.Script(code, { filename: `rendered-index.html#inline-script-${checked + 1}` });
    checked += 1;
  }
  assert.ok(checked >= 1);

  console.log("UNBOUND AI 100-mode library contract checks passed.");
}

main();
