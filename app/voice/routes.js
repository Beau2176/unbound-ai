const express = require("express");
const path = require("path");
const {
  synthesizeSpeech,
  publicHeyGenVoiceStatus,
  safeHeyGenVoiceError
} = require("./heygen-tts");

async function recordVoiceUsage(getPool, userId) {
  if (typeof getPool !== "function" || !userId) return;
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO usage_events (
       user_id,
       provider,
       model,
       event_type,
       input_tokens,
       output_tokens,
       total_tokens,
       web_search_calls
     )
     VALUES ($1, 'heygen', 'starfish', 'voice_speech', 0, 0, 0, 0)`,
    [userId]
  );
}

function createVoiceRouter({ env = process.env, getPool = null } = {}) {
  const router = express.Router();

  router.get("/status", (req, res) => {
    return res.json({
      ...publicHeyGenVoiceStatus(env),
      input: {
        preferred: "browser-speech-recognition",
        fallback: "typed-text"
      },
      privacy: {
        apiKeyExposedToBrowser: false,
        privateVoiceIdExposedToBrowser: false,
        audioStoredByUnbound: false
      }
    });
  });

  router.post("/speech", async (req, res) => {
    try {
      const result = await synthesizeSpeech({
        text: req.body?.text,
        env
      });

      try {
        await recordVoiceUsage(getPool, req.user?.id || null);
      } catch (usageError) {
        console.error(
          "UNBOUND AI VOICE USAGE RECORD ERROR:",
          usageError?.code || usageError?.message || "unknown"
        );
      }

      return res.status(201).json({
        ok: true,
        audioUrl: result.audioUrl,
        durationSeconds: result.durationSeconds,
        provider: result.provider,
        voiceName: result.voiceName,
        speed: result.speed,
        privacy: {
          apiKeyExposedToBrowser: false,
          privateVoiceIdExposedToBrowser: false,
          audioStoredByUnbound: false
        }
      });
    } catch (error) {
      const safe = safeHeyGenVoiceError(error);
      if (safe.code === "VOICE_PROVIDER_FAILED") {
        console.error(
          "UNBOUND AI VOICE PROVIDER ERROR:",
          error?.code || error?.status || error?.name || "provider-error"
        );
      }
      return res.status(safe.statusCode).json({
        error: safe.message,
        code: safe.code
      });
    }
  });

  return router;
}

function sendVoicePage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "voice.html"));
}

module.exports = {
  recordVoiceUsage,
  createVoiceRouter,
  sendVoicePage
};
