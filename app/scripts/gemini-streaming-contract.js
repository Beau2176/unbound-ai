const assert = require("assert");
const google = require("../ai/providers/google");
const { getGatewayStatus } = require("../ai/gateway");
const { providerCatalog } = require("../platform/registry");

function streamingResponse(chunks, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield Buffer.from(chunk, "utf8");
      }
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
    process.env.AI_PROVIDER = "google";
    process.env.GEMINI_API_KEY = "gemini-test-key";
    delete process.env.GEMINI_MODEL;
    delete process.env.GOOGLE_AI_MODEL;

    assert.strictEqual(google.DEFAULT_MODEL, "gemini-3.8-flash");
    assert.strictEqual(google.getModel(), "gemini-3.8-flash");
    assert.strictEqual(
      google.geminiEndpoint("gemini-3.8-flash", { streaming: true }),
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse"
    );

    assert.strictEqual(google.normalizeThinkingLevel("low"), "low");
    assert.strictEqual(google.normalizeThinkingLevel("medium"), "medium");
    assert.strictEqual(google.normalizeThinkingLevel("high"), "high");
    assert.strictEqual(google.normalizeThinkingLevel("xhigh"), "high");
    assert.strictEqual(google.normalizeThinkingLevel("max"), "high");
    assert.strictEqual(google.normalizeThinkingLevel("none"), "low");
    assert.strictEqual(google.normalizeThinkingLevel("minimal"), "low");
    assert.strictEqual(google.normalizeThinkingLevel("unsupported"), null);

    const body = google.buildGeminiRequestBody(
      "system instruction",
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "continue" }
      ]
    );
    assert.strictEqual(body.systemInstruction.parts[0].text, "system instruction");
    assert.strictEqual(body.contents[0].role, "user");
    assert.strictEqual(body.contents[1].role, "model");
    assert.strictEqual(body.contents[2].role, "user");

    const highThinkingBody = google.buildGeminiRequestBody(
      "system instruction",
      [{ role: "user", content: "deep problem" }],
      "high"
    );
    assert.strictEqual(
      highThinkingBody.generationConfig.thinkingConfig.thinkingLevel,
      "high"
    );
    const casualThinkingBody = google.buildGeminiRequestBody(
      "",
      [{ role: "user", content: "fast answer" }],
      "none"
    );
    assert.strictEqual(
      casualThinkingBody.generationConfig.thinkingConfig.thinkingLevel,
      "low"
    );
    assert.strictEqual(
      google.extractGeminiText({
        candidates: [{
          content: {
            parts: [
              { text: "thought summary", thought: true },
              { text: "visible answer" }
            ]
          }
        }]
      }),
      "visible answer"
    );

    assert.deepStrictEqual(
      google.parseSseEvent('data: {"candidates":[{"content":{"parts":[{"text":"A"}]}}]}'),
      { candidates: [{ content: { parts: [{ text: "A" }] } }] }
    );
    assert.strictEqual(google.parseSseEvent("data: [DONE]"), null);
    assert.throws(
      () => google.parseSseEvent("data: {not-json}"),
      (error) => error && error.code === "GEMINI_STREAM_INVALID_EVENT"
    );

    let generateRequest = null;
    const generated = await google.generateChat({
      instructions: "system instruction",
      input: [{ role: "user", content: "answer this" }],
      reasoningEffort: "low",
      fetchImpl: async (url, options) => {
        generateRequest = { url, options };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            responseId: "generate-1",
            candidates: [{
              content: {
                parts: [
                  { text: "hidden thought", thought: true },
                  { text: "answer" }
                ]
              }
            }]
          })
        };
      }
    });
    assert.strictEqual(generateRequest.options.redirect, "error");
    assert.strictEqual(
      JSON.parse(generateRequest.options.body).generationConfig.thinkingConfig.thinkingLevel,
      "low"
    );
    assert.strictEqual(generated.reply, "answer");

    let request = null;
    const deltas = [];
    const event1 = 'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}],"responseId":"resp-1"}\n\n';
    const event2 = 'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1},"responseId":"resp-1"}\n\n';
    const combined = event1 + event2;
    const splitAt = event1.length + 17;
    const chunks = [
      combined.slice(0, 11),
      combined.slice(11, splitAt),
      combined.slice(splitAt)
    ];

    const result = await google.streamChat({
      instructions: "system instruction",
      input: [{ role: "user", content: "hello" }],
      reasoningEffort: "medium",
      onDelta: async (delta) => deltas.push(delta),
      fetchImpl: async (url, options) => {
        request = { url, options };
        return streamingResponse(chunks);
      }
    });

    assert.strictEqual(
      request.url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse"
    );
    assert.strictEqual(request.options.method, "POST");
    assert.strictEqual(request.options.headers["x-goog-api-key"], "gemini-test-key");
    assert.strictEqual(request.options.headers.accept, "text/event-stream");
    assert.strictEqual(request.options.headers["content-type"], "application/json");
    assert.strictEqual(request.options.redirect, "error");
    const requestBody = JSON.parse(request.options.body);
    assert.strictEqual(requestBody.systemInstruction.parts[0].text, "system instruction");
    assert.strictEqual(
      requestBody.generationConfig.thinkingConfig.thinkingLevel,
      "medium"
    );
    assert.strictEqual(result.provider, "google");
    assert.strictEqual(result.model, "gemini-3.8-flash");
    assert.strictEqual(result.reply, "Hello");
    assert.deepStrictEqual(deltas, ["Hel", "lo"]);
    assert.strictEqual(result.responseId, "resp-1");
    assert.strictEqual(result.usage.promptTokenCount, 3);

    const gateway = getGatewayStatus();
    assert.strictEqual(gateway.provider, "google");
    assert.strictEqual(gateway.configured, true);
    assert.strictEqual(gateway.streaming, true);
    assert.strictEqual(gateway.research, false);

    const catalog = providerCatalog({
      GEMINI_API_KEY: "configured"
    });
    const googleProvider = catalog.find((provider) => provider.id === "google");
    assert(googleProvider);
    assert.strictEqual(googleProvider.configured, true);
    assert.strictEqual(googleProvider.chat, true);
    assert.strictEqual(googleProvider.streaming, true);
    assert.strictEqual(googleProvider.reasoningControls, true);
    assert.deepStrictEqual(Array.from(googleProvider.supportedThinkingLevels), ["low", "medium", "high"]);
    assert.strictEqual(googleProvider.defaultThinkingLevel, "medium");
    assert.strictEqual(googleProvider.defaultModel, "gemini-3.8-flash");
    assert.strictEqual(
      googleProvider.adapterState,
      "active-gemini-3.8-chat-streaming-thinking"
    );
    const anthropicProvider = catalog.find((provider) => provider.id === "anthropic");
    assert(anthropicProvider);
    assert.strictEqual(anthropicProvider.reasoningControls, true);
    assert.strictEqual(anthropicProvider.supportedThinkingLevels, undefined);
    assert.strictEqual(anthropicProvider.defaultThinkingLevel, undefined);
    assert.deepStrictEqual(
      Array.from(anthropicProvider.supportedEffortLevels),
      ["low", "medium", "high", "xhigh", "max"]
    );
    assert.strictEqual(anthropicProvider.defaultModel, "claude-sonnet-5");
    assert.strictEqual(googleProvider.supportedEffortLevels, undefined);
    assert.strictEqual(googleProvider.defaultEffort, undefined);

    await assert.rejects(
      () => google.streamChat({
        instructions: "system",
        input: [{ role: "user", content: "test" }],
        fetchImpl: async () => streamingResponse(["data: {broken}\n\n"])
      }),
      (error) => error && error.code === "GEMINI_STREAM_INVALID_EVENT"
    );

    console.log("PASS Gemini streaming parity: native SSE chat streaming, bounded parsing, 3.8 reasoning controls, thought filtering, redirect hardening, and low-latency fallback.");
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
