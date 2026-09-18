const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  normalizeKnowledgeQuery,
  queryKey,
  freshnessHoursForQuery,
  sensitiveCommunityText,
  personalizedOrHighStakesQuery,
  shareablePublicKnowledge,
  selectDirectKnowledgeAnswer,
  normalizeSources
} = require("../knowledge/adaptive");
const {
  INTEGRATION_VERSION,
  integrateAdaptiveKnowledgeServerSource
} = require("../knowledge/server-integration");
const { integrateEmailVerificationServerSource } = require("../email/server-integration");
const { integrateBillingServerSource } = require("../billing/server-integration");
const { integrateFileAnalysisServerSource } = require("../files/server-integration");
const { integrateImageUnderstandingServerSource } = require("../images/server-integration");
const { integrateVoiceServerSource } = require("../voice/server-integration");
const { integrateCommandCenterServerSource } = require("../command-center/server-integration");
const { integrateScheduledTasksServerSource } = require("../tasks/server-integration");
const { integrateAgentServerSource } = require("../agents/server-integration");
const { integrateMemoryServerSource } = require("../memory/server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildIntegratedSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  let integrated = integrateEmailVerificationServerSource(source);
  integrated = integrateBillingServerSource(integrated);
  integrated = integrateFileAnalysisServerSource(integrated);
  integrated = integrateImageUnderstandingServerSource(integrated);
  integrated = integrateVoiceServerSource(integrated);
  integrated = integrateCommandCenterServerSource(integrated);
  integrated = integrateScheduledTasksServerSource(integrated);
  integrated = integrateAgentServerSource(integrated);
  integrated = integrateMemoryServerSource(integrated);
  return integrateAdaptiveKnowledgeServerSource(integrated);
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v0.97");
  assert.strictEqual(normalizeKnowledgeQuery("  Hello   WORLD  "), "hello world");
  assert.strictEqual(queryKey("Hello world"), queryKey("  hello   WORLD "));
  assert.ok(freshnessHoursForQuery("weather today") <= 12);
  assert.ok(freshnessHoursForQuery("history of Wyoming") >= 24 * 30);
  assert.strictEqual(sensitiveCommunityText("my password is swordfish"), true);
  assert.strictEqual(sensitiveCommunityText("Denver is the capital of Colorado."), false);
  assert.strictEqual(personalizedOrHighStakesQuery("What is the capital of Colorado?"), false);
  assert.strictEqual(personalizedOrHighStakesQuery("What medicine should I take?"), true);
  assert.strictEqual(shareablePublicKnowledge(
    "What is the capital of Colorado?",
    "Denver is the capital of Colorado."
  ), true);
  assert.strictEqual(shareablePublicKnowledge(
    "What medicine should I take?",
    "Take something."
  ), false);

  const reusableItem = {
    id: "4",
    answer: "Denver is the capital of Colorado.",
    learnedFrom: "web",
    confidence: 0.88,
    verifiedAt: new Date().toISOString(),
    sources: [{ title: "Colorado", url: "https://www.colorado.gov/" }]
  };
  assert.ok(selectDirectKnowledgeAnswer({
    query: "What is the capital of Colorado?",
    productMode: "standard",
    depthStyle: "casual",
    history: [],
    adaptiveKnowledge: { exactFresh: true, items: [reusableItem] }
  }));
  assert.strictEqual(selectDirectKnowledgeAnswer({
    query: "What is the capital of Colorado?",
    productMode: "standard",
    depthStyle: "work",
    history: [],
    adaptiveKnowledge: { exactFresh: true, items: [reusableItem] }
  }), null);
  assert.strictEqual(selectDirectKnowledgeAnswer({
    query: "What medicine should I take?",
    productMode: "standard",
    depthStyle: "casual",
    history: [],
    adaptiveKnowledge: { exactFresh: true, items: [reusableItem] }
  }), null);

  assert.deepStrictEqual(
    normalizeSources([
      { title: "Example", url: "https://example.com/a" },
      { title: "Duplicate", url: "https://example.com/a" },
      { title: "Bad", url: "javascript:alert(1)" }
    ]),
    [{ title: "Example", url: "https://example.com/a" }]
  );

  const integrated = buildIntegratedSource();
  assert.strictEqual(count(integrated, 'require("./knowledge/adaptive")'), 1);
  assert.strictEqual(count(integrated, 'require("./knowledge/routes")'), 1);
  assert.strictEqual(count(integrated, "CREATE TABLE IF NOT EXISTS adaptive_knowledge"), 1);
  assert.strictEqual(count(integrated, "CREATE TABLE IF NOT EXISTS community_learning_preferences"), 1);
  assert.strictEqual(count(integrated, "await buildAdaptiveKnowledgeContext(pool, message)"), 2);
  assert.strictEqual(count(integrated, "projectContextInstructions, styleInstructions, memoryInstructions, adaptiveKnowledgeInstructions, depthInstructions"), 2);
  assert.strictEqual(count(integrated, "selectDirectKnowledgeAnswer({"), 2);
  assert.strictEqual(count(integrated, "knowledgeCacheHit: true"), 2);
  assert.strictEqual(count(integrated, "void learnFromResearch(pool"), 1);
  assert.strictEqual(count(integrated, '"/api/knowledge"'), 1);
  assert.strictEqual(count(integrated, '"/knowledge.html"'), 1);
  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const startSource = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  const memoryIndex = startSource.indexOf("integrateMemoryServerSource(integratedSource)");
  const adaptiveIndex = startSource.indexOf("integrateAdaptiveKnowledgeServerSource(integratedSource)");
  assert.ok(memoryIndex >= 0 && adaptiveIndex > memoryIndex);

  const page = fs.readFileSync(path.join(__dirname, "..", "knowledge.html"), "utf8");
  assert.ok(page.includes("Off by default"));
  assert.ok(page.includes("Raw conversations are not automatically copied"));
  assert.ok(page.includes("/api/knowledge/preferences"));
  assert.ok(page.includes("/api/knowledge/feedback"));

  console.log("UNBOUND AI Adaptive Knowledge Engine v0.97 contract checks passed.");
}

main();
