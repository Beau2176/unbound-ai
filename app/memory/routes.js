const express = require("express");
const path = require("path");
const {
  MAX_MEMORY_ITEMS,
  normalizeMemoryInput,
  validMemoryId,
  publicMemory
} = require("./context");

function createMemoryRouter({ getPool } = {}) {
  if (typeof getPool !== "function") {
    throw new Error("Memory requires a database pool provider.");
  }
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const result = await getPool().query(
        `SELECT id, content, enabled, created_at, updated_at
         FROM user_memories
         WHERE user_id = $1
         ORDER BY enabled DESC, updated_at DESC, id DESC
         LIMIT $2`,
        [req.user.id, MAX_MEMORY_ITEMS]
      );
      return res.json({ memories: result.rows.map(publicMemory) });
    } catch (error) {
      console.error("UNBOUND AI MEMORY LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load memory." });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const input = normalizeMemoryInput(req.body);
      const pool = getPool();
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS memories
         FROM user_memories
         WHERE user_id = $1`,
        [req.user.id]
      );
      if (Number(countResult.rows[0]?.memories || 0) >= MAX_MEMORY_ITEMS) {
        return res.status(409).json({
          error: `You can keep up to ${MAX_MEMORY_ITEMS} memory entries. Delete an old entry before adding another.`
        });
      }
      const result = await pool.query(
        `INSERT INTO user_memories (user_id, content, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id, content, enabled, created_at, updated_at`,
        [req.user.id, input.content, input.enabled]
      );
      return res.status(201).json({ memory: publicMemory(result.rows[0]) });
    } catch (error) {
      if (String(error?.code || "").startsWith("MEMORY_")) {
        return res.status(Number(error.statusCode) || 400).json({
          error: error.publicMessage || "Memory entry is invalid.",
          code: error.code
        });
      }
      console.error("UNBOUND AI MEMORY CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not save that memory." });
    }
  });

  router.put("/:id", async (req, res) => {
    const memoryId = String(req.params.id || "").trim();
    if (!validMemoryId(memoryId)) {
      return res.status(400).json({ error: "Invalid memory ID." });
    }
    try {
      const input = normalizeMemoryInput(req.body);
      const result = await getPool().query(
        `UPDATE user_memories
         SET content = $1,
             enabled = $2,
             updated_at = NOW()
         WHERE id = $3 AND user_id = $4
         RETURNING id, content, enabled, created_at, updated_at`,
        [input.content, input.enabled, memoryId, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Memory entry not found." });
      return res.json({ memory: publicMemory(result.rows[0]) });
    } catch (error) {
      if (String(error?.code || "").startsWith("MEMORY_")) {
        return res.status(Number(error.statusCode) || 400).json({
          error: error.publicMessage || "Memory entry is invalid.",
          code: error.code
        });
      }
      console.error("UNBOUND AI MEMORY UPDATE ERROR:", error);
      return res.status(500).json({ error: "Could not update that memory." });
    }
  });

  router.post("/:id/toggle", async (req, res) => {
    const memoryId = String(req.params.id || "").trim();
    if (!validMemoryId(memoryId)) return res.status(400).json({ error: "Invalid memory ID." });
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be true or false." });
    }
    try {
      const result = await getPool().query(
        `UPDATE user_memories
         SET enabled = $1,
             updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING id, content, enabled, created_at, updated_at`,
        [req.body.enabled, memoryId, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Memory entry not found." });
      return res.json({ memory: publicMemory(result.rows[0]) });
    } catch (error) {
      console.error("UNBOUND AI MEMORY TOGGLE ERROR:", error);
      return res.status(500).json({ error: "Could not change that memory." });
    }
  });

  router.delete("/:id", async (req, res) => {
    const memoryId = String(req.params.id || "").trim();
    if (!validMemoryId(memoryId)) return res.status(400).json({ error: "Invalid memory ID." });
    try {
      const result = await getPool().query(
        `DELETE FROM user_memories
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [memoryId, req.user.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Memory entry not found." });
      return res.json({ ok: true, id: memoryId });
    } catch (error) {
      console.error("UNBOUND AI MEMORY DELETE ERROR:", error);
      return res.status(500).json({ error: "Could not delete that memory." });
    }
  });

  return router;
}

function sendMemoryPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "memory.html"));
}

module.exports = {
  createMemoryRouter,
  sendMemoryPage
};
