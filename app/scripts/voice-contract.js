const assert = require("assert");
const {
  DEFAULT_HEYGEN_VOICE_ID,
  DEFAULT_HEYGEN_VOICE_NAME,
  HEYGEN_SPEECH_URL,
  clampSpeed,
  normalizeSpeechText,
  publicHeyGenVoiceStatus,
  synthesizeSpeech
} = require("../voice/heygen-tts");

async function main() {
  assert.strictEqual(DEFAULT_HEYGEN_VOICE_ID, "cbca446e24b94d66a6ef405d9eb8355f");
  assert.strictEqual(DEFAULT_HEYGEN_VOICE_NAME, "Boyd Voice V3");
  assert.strictEqual(HEYGEN_SPEECH_URL, "https://api.heygen.com/v3/voices/speech");
  assert.strictEqual(clampSpeed("1.25"), 1.25);
  assert.strictEqual(clampSpeed("99"), 2);
  assert.strictEqual(clampSpeed("bad"), 1);
  assert.throws(() => normalizeSpeechText(""), /Speech text is required/);

  const status = publicHeyGenVoiceStatus({
    HEYGEN_API_KEY: "secret-value"
  });
  assert.strictEqual(status.configured, true);
  assert.strictEqual(status.voiceId, DEFAULT_HEYGEN_VOICE_ID);
  assert.strictEqual(status.voiceName, DEFAULT_HEYGEN_VOICE_NAME);
  assert.strictEqual(status.rawApiKeyExposedToBrowser, false);
  assert.ok(!JSON.stringify(status).includes("secret-value"));

  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          audio_url: "https://example.com/generated-voice.mp3",
          duration: 1.8
        }
      })
    };
  };

  const result = await synthesizeSpeech({
    text: "Welcome to UNBOUND AI.",
    env: {
      HEYGEN_API_KEY: "secret-value"
    },
    fetchImpl
  });

  assert.strictEqual(result.voiceId, DEFAULT_HEYGEN_VOICE_ID);
  assert.strictEqual(result.voiceName, DEFAULT_HEYGEN_VOICE_NAME);
  assert.strictEqual(result.audioUrl, "https://example.com/generated-voice.mp3");
  assert.strictEqual(request.url, HEYGEN_SPEECH_URL);
  assert.strictEqual(request.options.headers["X-Api-Key"], "secret-value");
  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.voice_id, DEFAULT_HEYGEN_VOICE_ID);
  assert.strictEqual(body.input_type, "text");
  assert.strictEqual(body.speed, 1);
  assert.strictEqual(body.language, "en");

  await assert.rejects(
    () => synthesizeSpeech({
      text: "Hello",
      env: {},
      fetchImpl
    }),
    (error) => error && error.code === "VOICE_PROVIDER_NOT_CONFIGURED"
  );

  console.log("UNBOUND AI Boyd voice checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
