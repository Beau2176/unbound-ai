const INTEGRATION_VERSION = "v1.0";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Memory integration marker is missing: ${label}.`);
    error.code = "MEMORY_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Memory integration marker is ambiguous: ${label}.`);
    error.code = "MEMORY_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function replaceExpectedCount(source, marker, replacement, expected, label) {
  const matches = source.split(marker).length - 1;
  if (matches !== expected) {
    const error = new Error(`Memory integration expected ${expected} marker(s) for ${label}; found ${matches}.`);
    error.code = "MEMORY_SERVER_INTEGRATION_MARKER_COUNT_CHANGED";
    throw error;
  }
  return source.split(marker).join(replacement);
}

function integrateMemoryServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "MEMORY_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const agentImports = `const { createAgentRouter, sendAgentPage } = require("./agents/routes");\nconst { startAgentWorker } = require("./agents/runner");`;
  source = replaceExactlyOnce(
    source,
    agentImports,
    `${agentImports}\nconst { createMemoryRouter, sendMemoryPage } = require("./memory/routes");\nconst { buildMemoryPrompt } = require("./memory/context");\nconst { buildProjectCoreMemoryPrompt, getProjectIdentity } = require("./project/identity");\nconst { buildProjectContext } = require("./platform/project-memory");`,
    "memory-imports"
  );

  const agentPage = `app.get(\n  "/agents.html",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("agents"),\n  sendAgentPage\n);`;
  source = replaceExactlyOnce(
    source,
    agentPage,
    `${agentPage}\napp.get(\n  "/memory.html",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("memory"),\n  sendMemoryPage\n);`,
    "memory-page-route"
  );

  const agentStepIndex = `CREATE INDEX IF NOT EXISTS agent_steps_user_run_idx\n      ON agent_steps(user_id, run_id, step_number);`;
  source = replaceExactlyOnce(
    source,
    agentStepIndex,
    `${agentStepIndex}\n\n    CREATE TABLE IF NOT EXISTS user_memories (\n      id BIGSERIAL PRIMARY KEY,\n      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n      content TEXT NOT NULL,\n      enabled BOOLEAN NOT NULL DEFAULT TRUE,\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      CONSTRAINT user_memories_content_check\n        CHECK (char_length(content) BETWEEN 1 AND 800)\n    );\n\n    CREATE INDEX IF NOT EXISTS user_memories_user_idx\n      ON user_memories(user_id, enabled, updated_at DESC, id DESC);`,
    "memory-schema"
  );

  const styleMarker = `    const styleInstructions = getAiStylePrompt(aiStyle);`;
  source = replaceExpectedCount(
    source,
    styleMarker,
    `${styleMarker}\n    const projectMemoryInstructions = buildProjectCoreMemoryPrompt();\n    const memoryInstructions = persistentChat?.user\n      ? await buildMemoryPrompt(pool, persistentChat.user.id, message)\n      : "";\n    const projectContextInstructions = persistentChat?.user && req.body?.projectId\n      ? await buildProjectContext(pool, persistentChat.user.id, req.body.projectId, message)\n      : "";`,
    2,
    "memory-chat-load"
  );

  const instructionArray = `[UNBOUND_SYSTEM_PROMPT, styleInstructions, depthInstructions, modeInstructions]`;
  source = replaceExpectedCount(
    source,
    instructionArray,
    `[UNBOUND_SYSTEM_PROMPT, projectMemoryInstructions, projectContextInstructions, styleInstructions, memoryInstructions, depthInstructions, modeInstructions]`,
    2,
    "memory-chat-instructions"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `app.get("/api/project/identity", (req, res) => {\n  return sendStatusJson(res, 200, getProjectIdentity());\n});\n\napp.use(\n  "/api/memory",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("memory"),\n  createMemoryRouter({\n    getPool: () => pool\n  })\n);\n\n${healthRoute}`,
    "memory-api-mount"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  replaceExpectedCount,
  integrateMemoryServerSource
};
