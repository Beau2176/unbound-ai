const INTEGRATION_VERSION = "v1.2";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Runtime capability integration marker is missing: ${label}.`);
    error.code = "RUNTIME_CAPABILITY_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Runtime capability integration marker is ambiguous: ${label}.`);
    error.code = "RUNTIME_CAPABILITY_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function replaceExpectedCount(source, marker, replacement, expected, label) {
  const count = source.split(marker).length - 1;
  if (count !== expected) {
    const error = new Error(`Runtime capability integration expected ${expected} marker(s) for ${label}; found ${count}.`);
    error.code = "RUNTIME_CAPABILITY_MARKER_COUNT_CHANGED";
    throw error;
  }
  return source.split(marker).join(replacement);
}

function integrateRuntimeCapabilitiesServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "RUNTIME_CAPABILITY_SOURCE_EMPTY";
    throw error;
  }
  if (source.includes('app.get("/api/capabilities/runtime"') && source.includes("buildRuntimeCapabilityPrompt")) {
    return source;
  }

  const diagnosticsImport = `const { getSelfHealSupervisor } = require("./ops/self-heal");`;
  source = replaceExactlyOnce(
    source,
    diagnosticsImport,
    `${diagnosticsImport}\nconst {\n  normalizeClientCapabilities,\n  shouldAutoResearch,\n  buildRuntimeCapabilityPrompt,\n  publicRuntimeCapabilities\n} = require("./capabilities/runtime");`,
    "runtime-capability-imports"
  );

  const knowledgeLoad = `    const adaptiveKnowledgeInstructions = adaptiveKnowledge.prompt;`;
  source = replaceExpectedCount(
    source,
    knowledgeLoad,
    `${knowledgeLoad}\n    const clientCapabilities = normalizeClientCapabilities(req.body?.clientCapabilities);\n    const runtimeDiagnostics = await diagnosticsMonitor.getSnapshot().catch(() => null);\n    const runtimeCapabilityInstructions = buildRuntimeCapabilityPrompt({\n      diagnostics: runtimeDiagnostics,\n      clientCapabilities\n    });\n    const autoResearch = shouldAutoResearch(message);`,
    2,
    "runtime-capability-chat-load"
  );

  const instructionArray = `[UNBOUND_SYSTEM_PROMPT, projectMemoryInstructions, projectContextInstructions, styleInstructions, memoryInstructions, adaptiveKnowledgeInstructions, depthInstructions, modeInstructions]`;
  source = replaceExpectedCount(
    source,
    instructionArray,
    `[UNBOUND_SYSTEM_PROMPT, projectMemoryInstructions, projectContextInstructions, runtimeCapabilityInstructions, styleInstructions, memoryInstructions, adaptiveKnowledgeInstructions, depthInstructions, modeInstructions]`,
    2,
    "runtime-capability-instructions"
  );

  const directKnowledgeMarker = `const directKnowledgeAnswer = selectDirectKnowledgeAnswer({`;
  source = replaceExpectedCount(
    source,
    directKnowledgeMarker,
    `const directKnowledgeAnswer = autoResearch ? null : selectDirectKnowledgeAnswer({`,
    2,
    "auto-research-bypass-cache"
  );

  const researchMarker = `        research:\n          productMode === "research"\n            ? { enabled: true, maxToolCalls: depthStyle === "work" ? 8 : 4 }\n            : null`;
  source = replaceExpectedCount(
    source,
    researchMarker,
    `        research:\n          (productMode === "research" || autoResearch)\n            ? { enabled: true, maxToolCalls: depthStyle === "work" ? 8 : 4 }\n            : null`,
    1,
    "auto-research-routing"
  );

  const diagnosticsRoute = `app.get("/health/diagnostics", async (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    diagnosticsRoute,
    `app.get("/api/capabilities/runtime", async (req, res) => {\n  const diagnostics = await diagnosticsMonitor.getSnapshot().catch(() => null);\n  return sendStatusJson(res, 200, publicRuntimeCapabilities({ diagnostics }));\n});\n\n${diagnosticsRoute}`,
    "runtime-capability-route"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  replaceExpectedCount,
  integrateRuntimeCapabilitiesServerSource
};
