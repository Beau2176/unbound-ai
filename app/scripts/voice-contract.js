const assert = require("assert");
const {
  DEFAULT_HEYGEN_VOICE_NAME,
  HEYGEN_SPEECH_URL,
  clampSpeed,
  normalizeSpeechText,
  publicHeyGenVoiceStatus,
  synthesizeSpeech
} = require("../voice/heygen-tts");
const {
  OPENAI_SPEECH_URL,
  OPENAI_TTS_MODEL,
  CLOUD_VOICES,
  publicOpenAiSpeechStatus,
  synthesizeOpenAiSpeech
} = require("../voice/openai-tts");
const { recordVoiceUsage, recordNaturalVoiceUsage } = require("../voice/routes");

async function main() {
  const privateVoiceId = "private-test-voice-id";
  assert.strictEqual(DEFAULT_HEYGEN_VOICE_NAME, "Boyd Voice V3");
  assert.strictEqual(HEYGEN_SPEECH_URL, "https://api.heygen.com/v3/voices/speech");
  assert.strictEqual(clampSpeed("1.25"), 1.25);
  assert.strictEqual(clampSpeed("99"), 2);
  assert.strictEqual(clampSpeed("bad"), 1);
  assert.throws(() => normalizeSpeechText(""), /Speech text is required/);

  const status = publicHeyGenVoiceStatus({
    HEYGEN_API_KEY: "secret-value",
    HEYGEN_VOICE_ID: privateVoiceId
  });
  assert.strictEqual(status.configured, true);
  assert.strictEqual(status.voiceName, DEFAULT_HEYGEN_VOICE_NAME);
  assert.strictEqual(status.privateVoiceIdConfigured, true);
  assert.strictEqual(status.rawApiKeyExposedToBrowser, false);
  assert.strictEqual(status.privateVoiceIdExposedToBrowser, false);
  assert.ok(!JSON.stringify(status).includes("secret-value"));
  assert.ok(!JSON.stringify(status).includes(privateVoiceId));

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
      HEYGEN_API_KEY: "secret-value",
      HEYGEN_VOICE_ID: privateVoiceId
    },
    fetchImpl
  });

  assert.strictEqual(result.voiceId, privateVoiceId);
  assert.strictEqual(result.voiceName, DEFAULT_HEYGEN_VOICE_NAME);
  assert.strictEqual(result.audioUrl, "https://example.com/generated-voice.mp3");
  assert.strictEqual(request.url, HEYGEN_SPEECH_URL);
  assert.strictEqual(request.options.headers["X-Api-Key"], "secret-value");
  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.voice_id, privateVoiceId);
  assert.strictEqual(body.input_type, "text");
  assert.strictEqual(body.speed, 1);
  assert.strictEqual(body.language, "en");

  assert.strictEqual(OPENAI_TTS_MODEL, "gpt-4o-mini-tts");
  assert.strictEqual(OPENAI_SPEECH_URL, "https://api.openai.com/v1/audio/speech");
  assert.strictEqual(CLOUD_VOICES.warm.voice, "coral");
  assert.strictEqual(CLOUD_VOICES.deep.voice, "onyx");
  assert.strictEqual(CLOUD_VOICES.bright.voice, "shimmer");
  assert.strictEqual(CLOUD_VOICES.calm.voice, "cedar");

  const openAiStatus = publicOpenAiSpeechStatus({ OPENAI_API_KEY: "openai-secret" });
  assert.strictEqual(openAiStatus.configured, true);
  assert.strictEqual(openAiStatus.model, OPENAI_TTS_MODEL);
  assert.strictEqual(openAiStatus.presets.length, 4);
  assert.ok(!JSON.stringify(openAiStatus).includes("openai-secret"));

  let openAiRequest = null;
  const openAiFetch = async (url, options) => {
    openAiRequest = { url, options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => "audio/mpeg" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
    };
  };

  const openAiResult = await synthesizeOpenAiSpeech({
    text: "This voice should sound natural and distinct.",
    preset: "deep",
    env: { OPENAI_API_KEY: "openai-secret" },
    fetchImpl: openAiFetch
  });

  assert.strictEqual(openAiResult.provider, "openai");
  assert.strictEqual(openAiResult.model, OPENAI_TTS_MODEL);
  assert.strictEqual(openAiResult.voice, "onyx");
  assert.strictEqual(openAiResult.preset, "deep");
  assert.strictEqual(openAiRequest.url, OPENAI_SPEECH_URL);
  assert.strictEqual(openAiRequest.options.headers.Authorization, "Bearer openai-secret");
  const openAiBody = JSON.parse(openAiRequest.options.body);
  assert.strictEqual(openAiBody.model, OPENAI_TTS_MODEL);
  assert.strictEqual(openAiBody.voice, "onyx");
  assert.strictEqual(openAiBody.response_format, "mp3");
  assert.ok(openAiBody.instructions.includes("natural"));
  assert.ok(!JSON.stringify(openAiResult).includes("openai-secret"));

  const queries = [];
  const fakePool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    }
  };
  await recordVoiceUsage(() => fakePool, "42");
  assert.strictEqual(queries.length, 1);
  assert.ok(queries[0].sql.includes("INSERT INTO usage_events"));
  assert.ok(queries[0].sql.includes("voice_speech"));
  assert.deepStrictEqual(queries[0].params, ["42"]);

  await recordNaturalVoiceUsage(() => fakePool, "42");
  assert.strictEqual(queries.length, 2);
  assert.ok(queries[1].sql.includes("'openai'"));
  assert.deepStrictEqual(queries[1].params, ["42", OPENAI_TTS_MODEL]);

  await recordVoiceUsage(() => null, "42");
  await recordVoiceUsage(() => fakePool, null);
  await recordNaturalVoiceUsage(() => null, "42");
  await recordNaturalVoiceUsage(() => fakePool, null);
  assert.strictEqual(queries.length, 2);

  await assert.rejects(
    () => synthesizeSpeech({
      text: "Hello",
      env: { HEYGEN_VOICE_ID: privateVoiceId },
      fetchImpl
    }),
    (error) => error && error.code === "VOICE_PROVIDER_NOT_CONFIGURED"
  );

  await assert.rejects(
    () => synthesizeOpenAiSpeech({
      text: "Hello",
      preset: "warm",
      env: {},
      fetchImpl: openAiFetch
    }),
    (error) => error && error.code === "OPENAI_SPEECH_NOT_CONFIGURED"
  );

  console.log("UNBOUND AI HeyGen and natural OpenAI voice checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
