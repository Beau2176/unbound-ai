const express = require("express");
const path = require("path");
const {
  synthesizeSpeech,
  publicHeyGenVoiceStatus,
  safeHeyGenVoiceError
} = require("./heygen-tts");

function createVoiceRouter({ env = process.env } = {}) {
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

      return res.status(201).json({
        ok: true,
        audioUrl: result.audioUrl,
        durationSeconds: result.durationSeconds,
        provider: result.provider,
        voiceId: result.voiceId,
        voiceName: result.voiceName,
        speed: result.speed,
        privacy: {
          apiKeyExposedToBrowser: false,
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
  createVoiceRouter,
  sendVoicePage
};
