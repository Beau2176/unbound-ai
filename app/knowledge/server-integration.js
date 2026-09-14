const INTEGRATION_VERSION = "v0.95";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Adaptive knowledge integration marker is missing: ${label}.`);
    error.code = "ADAPTIVE_KNOWLEDGE_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Adaptive knowledge integration marker is ambiguous: ${label}.`);
    error.code = "ADAPTIVE_KNOWLEDGE_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function replaceExpectedCount(source, marker, replacement, expected, label) {
  const matches = source.split(marker).length - 1;
  if (matches !== expected) {
    const error = new Error(`Adaptive knowledge integration expected ${expected} marker(s) for ${label}; found ${matches}.`);
    error.code = "ADAPTIVE_KNOWLEDGE_MARKER_COUNT_CHANGED";
    throw error;
  }
  return source.split(marker).join(replacement);
}

function integrateAdaptiveKnowledgeServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "ADAPTIVE_KNOWLEDGE_SOURCE_EMPTY";
    throw error;
  }

  const projectMemoryImport = `const { buildProjectCoreMemoryPrompt, getProjectIdentity } = require("./project/identity");`;
  source = replaceExactlyOnce(
    source,
    projectMemoryImport,
    `${projectMemoryImport}\nconst { buildAdaptiveKnowledgeContext, learnFromResearch } = require("./knowledge/adaptive");\nconst { createKnowledgeRouter, sendKnowledgePage } = require("./knowledge/routes");`,
    "knowledge-imports"
  );

  const memoryIndex = `CREATE INDEX IF NOT EXISTS user_memories_user_idx\n      ON user_memories(user_id, enabled, updated_at DESC, id DESC);`;
  source = replaceExactlyOnce(
    source,
    memoryIndex,
    `${memoryIndex}\n\n    CREATE TABLE IF NOT EXISTS adaptive_knowledge (\n      id BIGSERIAL PRIMARY KEY,\n      query_key TEXT NOT NULL,\n      answer_key TEXT NOT NULL,\n      query_text TEXT NOT NULL,\n      answer_text TEXT NOT NULL,\n      sources JSONB NOT NULL DEFAULT '[]'::jsonb,\n      learned_from TEXT NOT NULL,\n      confidence REAL NOT NULL DEFAULT 0.50,\n      times_seen INTEGER NOT NULL DEFAULT 1,\n      times_used INTEGER NOT NULL DEFAULT 0,\n      verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      expires_at TIMESTAMPTZ NOT NULL,\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      CONSTRAINT adaptive_knowledge_source_check CHECK (learned_from IN ('web', 'community')),\n      CONSTRAINT adaptive_knowledge_confidence_check CHECK (confidence >= 0 AND confidence <= 1)\n    );\n\n    CREATE UNIQUE INDEX IF NOT EXISTS adaptive_knowledge_identity_idx\n      ON adaptive_knowledge(query_key, answer_key, learned_from);\n\n    CREATE INDEX IF NOT EXISTS adaptive_knowledge_query_idx\n      ON adaptive_knowledge(query_key, expires_at DESC, confidence DESC);\n\n    CREATE INDEX IF NOT EXISTS adaptive_knowledge_search_idx\n      ON adaptive_knowledge USING GIN (\n        to_tsvector('english', COALESCE(query_text, '') || ' ' || COALESCE(answer_text, ''))\n      );\n\n    CREATE TABLE IF NOT EXISTS community_learning_preferences (\n      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,\n      enabled BOOLEAN NOT NULL DEFAULT FALSE,\n      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n    );`,
    "knowledge-schema"
  );

  const memoryLoad = `    const memoryInstructions = persistentChat?.user\n      ? await buildMemoryPrompt(pool, persistentChat.user.id)\n      : "";`;
  source = replaceExpectedCount(
    source,
    memoryLoad,
    `${memoryLoad}\n    const adaptiveKnowledge = await buildAdaptiveKnowledgeContext(pool, message);\n    const adaptiveKnowledgeInstructions = adaptiveKnowledge.prompt;`,
    2,
    "knowledge-chat-load"
  );

  const memoryInstructionArray = `[UNBOUND_SYSTEM_PROMPT, projectMemoryInstructions, styleInstructions, memoryInstructions, depthInstructions, modeInstructions]`;
  source = replaceExpectedCount(
    source,
    memoryInstructionArray,
    `[UNBOUND_SYSTEM_PROMPT, projectMemoryInstructions, styleInstructions, memoryInstructions, adaptiveKnowledgeInstructions, depthInstructions, modeInstructions]`,
    2,
    "knowledge-chat-instructions"
  );

  const researchMetadata = `    const researchMetadata = aiResponse.research || {\n      sources: [],\n      citations: [],\n      webSearchCalls: 0\n    };`;
  source = replaceExactlyOnce(
    source,
    researchMetadata,
    `${researchMetadata}\n\n    void learnFromResearch(pool, {\n      query: message,\n      answer: aiResponse.reply,\n      research: researchMetadata\n    }).catch((error) => {\n      console.warn("UNBOUND AI ADAPTIVE KNOWLEDGE LEARNING WARNING:", error?.message || error);\n    });`,
    "knowledge-research-learning"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `app.get(\n  "/knowledge.html",\n  requireDatabase,\n  requireSignedIn,\n  sendKnowledgePage\n);\n\napp.use(\n  "/api/knowledge",\n  requireDatabase,\n  requireSignedIn,\n  createKnowledgeRouter({ getPool: () => pool })\n);\n\n${healthRoute}`,
    "knowledge-routes"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  replaceExpectedCount,
  integrateAdaptiveKnowledgeServerSource
};
