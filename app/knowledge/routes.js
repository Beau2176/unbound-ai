const express = require("express");
const path = require("path");
const {
  getCommunityLearningPreference,
  setCommunityLearningPreference,
  learnFromCommunity,
  getAdaptiveKnowledgeStats
} = require("./adaptive");

function createKnowledgeRouter({ getPool } = {}) {
  if (typeof getPool !== "function") {
    throw new Error("Adaptive knowledge requires a database pool provider.");
  }

  const router = express.Router();

  router.get("/status", async (req, res) => {
    try {
      const stats = await getAdaptiveKnowledgeStats(getPool());
      return res.json({
        engine: "UNBOUND Adaptive Knowledge Engine",
        version: "v0.95",
        learning: {
          publicWebResearch: true,
          communityLearning: "opt-in",
          rawConversationHarvesting: false,
          autonomousCodeModification: false
        },
        stats
      });
    } catch (error) {
      console.error("UNBOUND AI KNOWLEDGE STATUS ERROR:", error);
      return res.status(500).json({ error: "Could not load adaptive knowledge status." });
    }
  });

  router.get("/preferences", async (req, res) => {
    try {
      const enabled = await getCommunityLearningPreference(getPool(), req.user.id);
      return res.json({ communityLearningEnabled: enabled });
    } catch (error) {
      console.error("UNBOUND AI KNOWLEDGE PREFERENCE ERROR:", error);
      return res.status(500).json({ error: "Could not load community learning preference." });
    }
  });

  router.put("/preferences", async (req, res) => {
    if (typeof req.body?.communityLearningEnabled !== "boolean") {
      return res.status(400).json({ error: "communityLearningEnabled must be true or false." });
    }
    try {
      const preference = await setCommunityLearningPreference(
        getPool(),
        req.user.id,
        req.body.communityLearningEnabled
      );
      return res.json({ communityLearningEnabled: preference.enabled, updatedAt: preference.updatedAt });
    } catch (error) {
      console.error("UNBOUND AI KNOWLEDGE PREFERENCE UPDATE ERROR:", error);
      return res.status(500).json({ error: "Could not update community learning preference." });
    }
  });

  router.post("/feedback", async (req, res) => {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!query || !content) {
      return res.status(400).json({ error: "A topic/question and correction or useful fact are required." });
    }
    try {
      const result = await learnFromCommunity(getPool(), {
        userId: req.user.id,
        query,
        content
      });
      if (!result.learned) {
        const status = result.reason === "opt-in-required" ? 403 : 400;
        const messages = {
          "opt-in-required": "Turn on community learning before contributing feedback.",
          "sensitive-content": "That contribution appears to contain private or sensitive information and was not added to shared knowledge.",
          "invalid-content": "That contribution could not be used."
        };
        return res.status(status).json({
          error: messages[result.reason] || "That contribution was not added to shared knowledge.",
          reason: result.reason
        });
      }
      return res.status(201).json({
        accepted: true,
        confidence: result.confidence,
        confirmations: result.confirmations,
        note: "Community knowledge becomes reusable only after independent confirmation."
      });
    } catch (error) {
      console.error("UNBOUND AI COMMUNITY LEARNING ERROR:", error);
      return res.status(500).json({ error: "Could not submit that learning contribution." });
    }
  });

  return router;
}

function sendKnowledgePage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "knowledge.html"));
}

module.exports = {
  createKnowledgeRouter,
  sendKnowledgePage
};
