const assert = require("assert");
const local = require("../ai/providers/local");
const { getGatewayStatus } = require("../ai/gateway");
const { providerCatalog } = require("../platform/registry");

function streamingResponse(chunks) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type"
          ? "text/event-stream"
          : null;
      }
    },
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield Buffer.from(chunk, "utf8");
      }
    }
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type"
          ? "application/json; charset=utf-8"
          : null;
      }
    },
    async json() {
      return payload;
    }
  };
}

async function main() {
  const tracked = [
    "AI_PROVIDER",
    "UNBOUND_LOCAL_AI_ENDPOINT",
    "UNBOUND_LOCAL_AI_MODEL",
    "UNBOUND_LOCAL_AI_API_KEY"
  ];
  const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

  try {
    process.env.AI_PROVIDER = "local";
    process.env.UNBOUND_LOCAL_AI_ENDPOINT = "http://127.0.0.1:11434";
    process.env.UNBOUND_LOCAL_AI_MODEL = "private-model";
    process.env.UNBOUND_LOCAL_AI_API_KEY = "local-secret";

    assert.strictEqual(local.endpoint(), "http://127.0.0.1:11434/v1/chat/completions");

    const body = local.buildLocalRequestBody(
      "system instruction",
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" }
      ],
      null,
      { streaming: true }
    );
    assert.strictEqual(body.model, "private-model");
    assert.strictEqual(body.stream, true);
    assert.strictEqual(body.messages[0].role, "system");
    assert.strictEqual(body.messages[0].content, "system instruction");
    assert.strictEqual(body.messages[1].role, "user");
    assert.strictEqual(body.messages[2].role, "assistant");

    assert.deepStrictEqual(
      local.parseOpenAiCompatibleSseEvent(
        'data: {"choices":[{"delta":{"content":"Hi"}}]}'
      ),
      { choices: [{ delta: { content: "Hi" } }] }
    );
    assert.strictEqual(local.parseOpenAiCompatibleSseEvent("data: [DONE]"), null);
    assert.throws(
      () => local.parseOpenAiCompatibleSseEvent("data: {broken}"),
      (error) => error && error.code === "LOCAL_AI_STREAM_INVALID_EVENT"
    );

    const first =
      'data: {"id":"local-stream-1","model":"private-model","choices":[{"delta":{"content":"Hel"}}]}\n\n';
    const second =
      'data: {"id":"local-stream-1","model":"private-model","choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n';
    const done = "data: [DONE]\n\n";
    const combined = first + second + done;
    const chunks = [
      combined.slice(0, 15),
      combined.slice(15, first.length + 21),
      combined.slice(first.length + 21)
    ];

    let request = null;
    const deltas = [];
    const result = await local.streamChat({
      instructions: "system instruction",
      input: [{ role: "user", content: "hello" }],
      onDelta: async (delta) => deltas.push(delta),
      fetchImpl: async (url, options) => {
        request = { url, options };
        return streamingResponse(chunks);
      }
    });

    assert.strictEqual(request.url, "http://127.0.0.1:11434/v1/chat/completions");
    assert.strictEqual(request.options.headers.authorization, "Bearer local-secret");
    assert.strictEqual(request.options.headers.accept, "text/event-stream, application/json");
    const requestBody = JSON.parse(request.options.body);
    assert.strictEqual(requestBody.stream, true);
    assert.strictEqual(result.provider, "local");
    assert.strictEqual(result.model, "private-model");
    assert.strictEqual(result.reply, "Hello");
    assert.deepStrictEqual(deltas, ["Hel", "lo"]);
    assert.strictEqual(result.responseId, "local-stream-1");
    assert.strictEqual(result.usage.prompt_tokens, 3);

    const fallbackDeltas = [];
    const fallback = await local.streamChat({
      instructions: "system instruction",
      input: [{ role: "user", content: "hello" }],
      onDelta: async (delta) => fallbackDeltas.push(delta),
      fetchImpl: async () => jsonResponse({
        id: "local-json-1",
        model: "private-model",
        choices: [{ message: { content: "one-shot fallback" } }],
        usage: { prompt_tokens: 2, completion_tokens: 3 }
      })
    });
    assert.strictEqual(fallback.reply, "one-shot fallback");
    assert.deepStrictEqual(fallbackDeltas, ["one-shot fallback"]);
    assert.strictEqual(fallback.responseId, "local-json-1");

    const gateway = getGatewayStatus();
    assert.strictEqual(gateway.provider, "local");
    assert.strictEqual(gateway.configured, true);
    assert.strictEqual(gateway.streaming, true);

    const catalog = providerCatalog({
      UNBOUND_LOCAL_AI_ENDPOINT: "http://127.0.0.1:11434"
    });
    const provider = catalog.find((item) => item.id === "local");
    assert(provider);
    assert.strictEqual(provider.chat, true);
    assert.strictEqual(provider.streaming, true);
    assert.strictEqual(provider.adapterState, "active-openai-compatible-streaming-chat");

    await assert.rejects(
      () => local.streamChat({
        instructions: "system",
        input: [{ role: "user", content: "test" }],
        fetchImpl: async () => streamingResponse([
          'data: {"error":{"message":"local overload"}}\n\n'
        ])
      }),
      (error) =>
        error &&
        error.code === "LOCAL_AI_STREAM_REMOTE_ERROR" &&
        /local overload/.test(error.message)
    );

    console.log("PASS local streaming parity: OpenAI-compatible SSE, fragmented events, JSON fallback, remote stream errors, and active gateway status.");
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
