const assert = require("assert");
const anthropic = require("../ai/providers/anthropic");
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
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_MAX_TOKENS"
  ];
  const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

  try {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5";
    process.env.ANTHROPIC_MAX_TOKENS = "2048";

    const body = anthropic.buildAnthropicRequestBody(
      "system instruction",
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "continue" }
      ],
      null,
      { streaming: true }
    );
    assert.strictEqual(body.model, "claude-sonnet-5");
    assert.strictEqual(body.max_tokens, 2048);
    assert.strictEqual(body.system, "system instruction");
    assert.strictEqual(body.stream, true);
    assert.strictEqual(body.messages[0].role, "user");
    assert.strictEqual(body.messages[1].role, "assistant");

    assert.deepStrictEqual(
      anthropic.parseAnthropicSseEvent(
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}'
      ),
      {
        event: "content_block_delta",
        payload: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hi" }
        }
      }
    );
    assert.strictEqual(anthropic.parseAnthropicSseEvent("event: ping\n"), null);
    assert.throws(
      () => anthropic.parseAnthropicSseEvent("event: message_delta\ndata: {broken}"),
      (error) => error && error.code === "ANTHROPIC_STREAM_INVALID_EVENT"
    );

    const event1 =
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","model":"claude-sonnet-5","usage":{"input_tokens":4,"output_tokens":1}}}\n\n';
    const event2 =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n';
    const event3 =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n';
    const event4 =
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n';
    const event5 =
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';

    const stream = event1 + event2 + event3 + event4 + event5;
    const chunks = [
      stream.slice(0, 29),
      stream.slice(29, event1.length + 13),
      stream.slice(event1.length + 13, event1.length + event2.length + event3.length - 7),
      stream.slice(event1.length + event2.length + event3.length - 7)
    ];

    let request = null;
    const deltas = [];
    const result = await anthropic.streamChat({
      instructions: "system instruction",
      input: [{ role: "user", content: "hello" }],
      onDelta: async (delta) => deltas.push(delta),
      fetchImpl: async (url, options) => {
        request = { url, options };
        return streamingResponse(chunks);
      }
    });

    assert.strictEqual(request.url, anthropic.ANTHROPIC_MESSAGES_URL);
    assert.strictEqual(request.options.method, "POST");
    assert.strictEqual(request.options.headers["x-api-key"], "anthropic-test-key");
    assert.strictEqual(request.options.headers["anthropic-version"], "2023-06-01");
    assert.strictEqual(request.options.headers.accept, "text/event-stream");
    const requestBody = JSON.parse(request.options.body);
    assert.strictEqual(requestBody.stream, true);
    assert.strictEqual(requestBody.system, "system instruction");

    assert.strictEqual(result.provider, "anthropic");
    assert.strictEqual(result.model, "claude-sonnet-5");
    assert.strictEqual(result.reply, "Hello");
    assert.deepStrictEqual(deltas, ["Hel", "lo"]);
    assert.strictEqual(result.responseId, "msg_123");
    assert.strictEqual(result.usage.input_tokens, 4);
    assert.strictEqual(result.usage.output_tokens, 3);

    const gateway = getGatewayStatus();
    assert.strictEqual(gateway.provider, "anthropic");
    assert.strictEqual(gateway.configured, true);
    assert.strictEqual(gateway.streaming, true);
    assert.strictEqual(gateway.research, false);

    const catalog = providerCatalog({
      ANTHROPIC_API_KEY: "configured"
    });
    const provider = catalog.find((item) => item.id === "anthropic");
    assert(provider);
    assert.strictEqual(provider.chat, true);
    assert.strictEqual(provider.streaming, true);
    assert.strictEqual(provider.adapterState, "active-streaming-text-chat");

    await assert.rejects(
      () => anthropic.streamChat({
        instructions: "system",
        input: [{ role: "user", content: "test" }],
        fetchImpl: async () => streamingResponse([
          'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n'
        ])
      }),
      (error) =>
        error &&
        error.code === "ANTHROPIC_STREAM_REMOTE_ERROR" &&
        /Overloaded/.test(error.message)
    );

    console.log("PASS Anthropic streaming parity: native SSE chat streaming, fragmented-event parsing, remote stream error handling, and active gateway status.");
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
