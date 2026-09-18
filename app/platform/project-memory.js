const MAX_PROJECT_MEMORY_ITEMS = 200;
const MAX_PROJECT_MEMORY_CHARS = 1200;
const MAX_PROJECT_CONTEXT_ITEMS = 30;
const MAX_PROJECT_CONTEXT_CHARS = 16000;

const STOP_WORDS = new Set([
  "about","after","again","also","and","are","because","been","before","being",
  "can","could","did","does","doing","for","from","have","how","into","just",
  "like","more","most","not","now","our","out","please","should","that","the",
  "their","them","then","there","these","they","this","those","through","too",
  "use","using","want","what","when","where","which","who","why","with","would",
  "you","your"
]);

function tokenize(value) {
  return [...new Set(
    String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,31}/g) || []
  )].filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function validProjectId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeProjectMemoryInput(body = {}) {
  const content = String(body.content || "").trim();
  if (!content || content.length > MAX_PROJECT_MEMORY_CHARS) {
    const error = new Error(`Project memory must be between 1 and ${MAX_PROJECT_MEMORY_CHARS} characters.`);
    error.code = "PROJECT_MEMORY_INVALID";
    error.statusCode = 400;
    throw error;
  }
  return { content, enabled: body.enabled !== false };
}

function score(content, query) {
  const text = String(content || "").toLowerCase();
  const tokens = tokenize(query);
  let value = 0;
  for (const token of tokens) {
    if (text.includes(token)) value += token.length >= 7 ? 3 : 2;
  }
  const phrase = String(query || "").trim().toLowerCase();
  if (phrase.length >= 8 && text.includes(phrase)) value += 8;
  return value;
}

function rankProjectMemories(memories, query, limit = MAX_PROJECT_CONTEXT_ITEMS) {
  const items = Array.isArray(memories) ? memories : [];
  const max = Math.max(1, Math.min(Number(limit) || MAX_PROJECT_CONTEXT_ITEMS, MAX_PROJECT_MEMORY_ITEMS));
  const tokens = tokenize(query);
  if (!tokens.length) return items.slice(0, max);
  const scored = items.map((memory, index) => ({
    memory, index, score: score(memory?.content, query)
  })).sort((a,b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, max).map((item) => item.memory);
}

async function loadProjectMemories(pool, userId, projectId) {
  if (!pool || !userId || !validProjectId(projectId)) return [];
  const result = await pool.query(
    `SELECT id, project_id, content, enabled, created_at, updated_at
     FROM project_memories
     WHERE user_id = $1 AND project_id = $2::uuid AND enabled = TRUE
     ORDER BY updated_at DESC, id DESC
     LIMIT $3`,
    [userId, projectId, MAX_PROJECT_MEMORY_ITEMS]
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    content: row.content,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

async function buildProjectContext(pool, userId, projectId, query = "") {
  if (!pool || !userId || !validProjectId(projectId)) return "";
  const projectResult = await pool.query(
    `SELECT id, name, description, status
     FROM ai_projects
     WHERE id = $1::uuid AND user_id = $2
     LIMIT 1`,
    [projectId, userId]
  );
  const project = projectResult.rows[0];
  if (!project) return "";

  const memories = rankProjectMemories(
    await loadProjectMemories(pool, userId, projectId),
    query
  );
  const lines = [
    `Project: ${project.name}`,
    project.description ? `Description: ${project.description}` : ""
  ].filter(Boolean);
  let used = lines.join("\n").length;
  for (const memory of memories) {
    const line = `- ${memory.content}`;
    if (used + line.length > MAX_PROJECT_CONTEXT_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

module.exports = {
  MAX_PROJECT_MEMORY_ITEMS,
  MAX_PROJECT_MEMORY_CHARS,
  MAX_PROJECT_CONTEXT_ITEMS,
  MAX_PROJECT_CONTEXT_CHARS,
  tokenize,
  validProjectId,
  normalizeProjectMemoryInput,
  score,
  rankProjectMemories,
  loadProjectMemories,
  buildProjectContext
};
