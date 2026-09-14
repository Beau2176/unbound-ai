const INTEGRATION_VERSION = "v1.0";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Action-control integration marker is missing: ${label}.`);
    error.code = "ACTION_CONTROL_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Action-control integration marker is ambiguous: ${label}.`);
    error.code = "ACTION_CONTROL_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function replaceExpectedCount(source, marker, replacement, expected, label) {
  const count = source.split(marker).length - 1;
  if (count !== expected) {
    const error = new Error(`Action-control integration expected ${expected} marker(s) for ${label}; found ${count}.`);
    error.code = "ACTION_CONTROL_MARKER_COUNT_CHANGED";
    throw error;
  }
  return source.split(marker).join(replacement);
}

function integrateActionControlServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "ACTION_CONTROL_SOURCE_EMPTY";
    throw error;
  }
  if (source.includes('app.use("/api/actions"') && source.includes("buildActionCapabilityPrompt")) return source;

  const selfHealImport = `const { getSelfHealSupervisor } = require("./ops/self-heal");`;
  source = replaceExactlyOnce(
    source,
    selfHealImport,
    `${selfHealImport}\nconst { createActionRouter, sendControlCenterPage } = require("./actions/routes");\nconst { buildActionCapabilityPrompt } = require("./actions/capability");`,
    "action-imports"
  );

  const runtimeInstruction = `    const runtimeCapabilityInstructions = buildRuntimeCapabilityPrompt({\n      diagnostics: runtimeDiagnostics,\n      clientCapabilities\n    });`;
  source = replaceExpectedCount(
    source,
    runtimeInstruction,
    `${runtimeInstruction}\n    const actionCapabilityInstructions = buildActionCapabilityPrompt({\n      clientCapabilities\n    });`,
    2,
    "action-chat-awareness"
  );

  const instructionArray = `[UNBOUND_SYSTEM_PROMPT, projectMemoryInstructions, runtimeCapabilityInstructions, styleInstructions, memoryInstructions, adaptiveKnowledgeInstructions, depthInstructions, modeInstructions]`;
  source = replaceExpectedCount(
    source,
    instructionArray,
    `[UNBOUND_SYSTEM_PROMPT, projectMemoryInstructions, runtimeCapabilityInstructions, actionCapabilityInstructions, styleInstructions, memoryInstructions, adaptiveKnowledgeInstructions, depthInstructions, modeInstructions]`,
    2,
    "action-chat-instructions"
  );

  const capabilityRoute = `app.get("/api/capabilities/runtime", async (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    capabilityRoute,
    `app.get(\n  "/control-center.html",\n  requireSignedIn,\n  sendControlCenterPage\n);\n\napp.use(\n  "/api/actions",\n  requireSignedIn,\n  createActionRouter()\n);\n\n${capabilityRoute}`,
    "action-routes"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  replaceExpectedCount,
  integrateActionControlServerSource
};
