const assert = require("assert");
const google = require("../ai/providers/google");
const gateway = require("../ai/gateway");
const { providerCatalog } = require("../platform/registry");

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

function sseResponse(frames, status = 200) {
  const encoder = new TextEncoder();
  return {
    ok: status >= 200 && status < 300,
    status,
    body: (async function* () {
      for (const frame of frames) {
        yield encoder.encode(frame);
      }
    })(),
    async json() {
      return {};
    }
  };
}

async function main() {
  const tracked = [
    "AI_PROVIDER",
    "GEMINI_API_KEY",
    "GOOGLE_AI_API_KEY",
    "GEMINI_MODEL",
    "GOOGLE_AI_MODEL"
  ];
  const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

  try {
    delete process.env.GEMINI_MODEL;
    delete process.env.GOOGLE_AI_MODEL;
    assert.strictEqual(google.getModel(), "gemini-3.8-flash");
    assert.strictEqual(google.DEFAULT_MODEL, "gemini-3.8-flash");

    assert.strictEqual(google.normalizeThinkingLevel("low"), "low");
    assert.strictEqual(google.normalizeThinkingLevel("medium"), "medium");
    assert.strictEqual(google.normalizeThinkingLevel("high"), "high");
    assert.strictEqual(google.normalizeThinkingLevel("xhigh"), "high");
    assert.strictEqual(google.normalizeThinkingLevel("max"), "high");
    assert.strictEqual(google.normalizeThinkingLevel("none"), null);
    assert.strictEqual(google.normalizeThinkingLevel("minimal"), null);

    const body = google.buildGenerateContentBody({
      instructions: "System instruction",
      input: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "Explain this" }
      ],
      reasoningEffort: "high"
    });
    assert.strictEqual(body.systemInstruction.parts[0].text, "System instruction");
    assert.deepStrictEqual(body.contents.map((item) => item.role), ["user", "model", "user"]);
    assert.strictEqual(body.generationConfig.thinkingConfig.thinkingLevel, "high");

    const noneBody = google.buildGenerateContentBody({
      input: [{ role: "user", content: "Fast answer" }],
      reasoningEffort: "none"
    });
    assert.strictEqual(noneBody.generationConfig, undefined);

    process.env.GEMINI_API_KEY = "gemini-contract-secret";
    delete process.env.GEMINI_MODEL;

    let generateRequest = null;
    const generated = await google.generateChat({
      instructions: "System",
      input: [{ role: "user", content: "Question" }],
      reasoningEffort: "low",
      fetchImpl: async (url, options) => {
        generateRequest = { url, options };
        return jsonResponse({
          responseId: "gemini-response-1",
          candidates: [{
            content: {
              parts: [
                { text: "private thought", thought: true },
                { text: "Final answer" }
              ]
            }
          }],
          usageMetadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 3
          }
        });
      }
    });

    assert(generateRequest.url.includes("/models/gemini-3.8-flash:generateContent"));
    assert.strictEqual(generateRequest.options.headers["x-goog-api-key"], "gemini-contract-secret");
    const generateBody = JSON.parse(generateRequest.options.body);
    assert.strictEqual(generateBody.generationConfig.thinkingConfig.thinkingLevel, "low");
    assert.strictEqual(generated.reply, "Final answer");
    assert.strictEqual(generated.responseId, "gemini-response-1");
    assert.strictEqual(generated.provider, "google");

    const deltas = [];
    let streamRequest = null;
    const streamed = await google.streamChat({
      instructions: "System",
      input: [{ role: "user", content: "Stream this" }],
      reasoningEffort: "medium",
      onDelta: async (delta) => deltas.push(delta),
      fetchImpl: async (url, options) => {
        streamRequest = { url, options };
        return sseResponse([
          'data: {"responseId":"stream-1","candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"world"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}\n',
          '\n'
        ]);
      }
    });

    assert(streamRequest.url.includes("/models/gemini-3.8-flash:streamGenerateContent?alt=sse"));
    assert.strictEqual(streamRequest.options.headers.accept, "text/event-stream");
    const streamBody = JSON.parse(streamRequest.options.body);
    assert.strictEqual(streamBody.generationConfig.thinkingConfig.thinkingLevel, "medium");
    assert.deepStrictEqual(deltas, ["Hello ", "world"]);
    assert.strictEqual(streamed.reply, "Hello world");
    assert.strictEqual(streamed.responseId, "stream-1");
    assert.deepStrictEqual(streamed.usage, {
      promptTokenCount: 3,
      candidatesTokenCount: 2
    });

    process.env.AI_PROVIDER = "google";
    const gatewayStatus = gateway.getGatewayStatus();
    assert.strictEqual(gatewayStatus.provider, "google");
    assert.strictEqual(gatewayStatus.configured, true);
    assert.strictEqual(gatewayStatus.model, "gemini-3.8-flash");
    assert.strictEqual(gatewayStatus.streaming, true);
    assert.strictEqual(gatewayStatus.research, false);

    const catalogGoogle = providerCatalog({
      GEMINI_API_KEY: "configured"
    }).find((provider) => provider.id === "google");
    assert(catalogGoogle);
    assert.strictEqual(catalogGoogle.configured, true);
    assert.strictEqual(catalogGoogle.chat, true);
    assert.strictEqual(catalogGoogle.streaming, true);
    assert.strictEqual(catalogGoogle.reasoningControls, true);
    assert.strictEqual(catalogGoogle.research, false);
    assert.strictEqual(catalogGoogle.defaultModel, "gemini-3.8-flash");
    assert.strictEqual(catalogGoogle.adapterState, "active-gemini-3.8-chat-streaming");

    console.log("PASS Gemini provider parity: 3.8 Flash default, thinking controls, true SSE streaming, and active provider catalog.");
  } finally {
    for (const key of tracked) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
