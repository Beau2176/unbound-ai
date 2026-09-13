const assert = require("assert");
const {
  DEFAULT_REALTIME_MODEL,
  DEFAULT_VOICE,
  REALTIME_CALL_URL,
  normalizeVoice,
  normalizeSdpOffer,
  publicRealtimeStatus,
  createRealtimeCall
} = require("../voice/realtime");

async function main() {
  assert.strictEqual(DEFAULT_REALTIME_MODEL, "gpt-realtime-2.1");
  assert.strictEqual(DEFAULT_VOICE, "marin");
  assert.strictEqual(REALTIME_CALL_URL, "https://api.openai.com/v1/realtime/calls");
  assert.strictEqual(normalizeVoice("CEDAR"), "cedar");
  assert.strictEqual(normalizeVoice("not-a-voice"), "marin");
  assert.throws(() => normalizeSdpOffer(""), /SDP offer is required/);
  assert.throws(() => normalizeSdpOffer("not-sdp"), /malformed/);

  const status = publicRealtimeStatus({
    OPENAI_API_KEY: "secret-value",
    OPENAI_REALTIME_MODEL: "gpt-realtime-2.1",
    OPENAI_REALTIME_VOICE: "cedar"
  });
  assert.strictEqual(status.configured, true);
  assert.strictEqual(status.voice, "cedar");
  assert.strictEqual(status.rawApiKeyExposedToBrowser, false);
  assert.ok(!JSON.stringify(status).includes("secret-value"));

  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "location" ? "/v1/realtime/calls/call_123" : null },
      text: async () => "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n"
    };
  };

  const result = await createRealtimeCall({
    sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
    instructions: "Be useful.",
    env: {
      OPENAI_API_KEY: "secret-value",
      OPENAI_REALTIME_MODEL: "gpt-realtime-2.1",
      OPENAI_REALTIME_VOICE: "cedar"
    },
    fetchImpl
  });

  assert.strictEqual(result.voice, "cedar");
  assert.strictEqual(result.model, "gpt-realtime-2.1");
  assert.strictEqual(request.url, REALTIME_CALL_URL);
  assert.strictEqual(request.options.headers.Authorization, "Bearer secret-value");
  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.session.type, "realtime");
  assert.deepStrictEqual(body.session.output_modalities, ["audio"]);
  assert.strictEqual(body.session.audio.output.voice, "cedar");
  assert.strictEqual(body.session.instructions, "Be useful.");

  await assert.rejects(
    () => createRealtimeCall({
      sdp: "v=0\r\n",
      env: {},
      fetchImpl
    }),
    (error) => error && error.code === "VOICE_PROVIDER_NOT_CONFIGURED"
  );

  console.log("UNBOUND AI voice realtime checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
