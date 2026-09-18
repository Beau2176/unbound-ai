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

    assert.strictEqual(anthropic.normalizeEffort("none"), "low");
    assert.strictEqual(anthropic.normalizeEffort("minimal"), "low");
    assert.strictEqual(anthropic.normalizeEffort("low"), "low");
    assert.strictEqual(anthropic.normalizeEffort("medium"), "medium");
    assert.strictEqual(anthropic.normalizeEffort("high"), "high");
    assert.strictEqual(anthropic.normalizeEffort("xhigh"), "xhigh");
    assert.strictEqual(anthropic.normalizeEffort("max"), "max");
    assert.strictEqual(anthropic.normalizeEffort("maximum"), "max");
    assert.strictEqual(anthropic.normalizeEffort("unsupported"), null);
    assert.strictEqual(anthropic.modelSupportsEffortControls("claude-sonnet-5"), true);
    assert.strictEqual(anthropic.modelSupportsEffortControls("claude-opus-5"), true);
    assert.strictEqual(anthropic.modelSupportsEffortControls("claude-sonnet-4-5-20250929"), false);
    assert.strictEqual(anthropic.supportsResearch(), true);
    assert.strictEqual(anthropic.normalizeResearchMaxUses(0), 1);
    assert.strictEqual(anthropic.normalizeResearchMaxUses(4), 4);
    assert.strictEqual(anthropic.normalizeResearchMaxUses(99), 10);

    const researchTool = anthropic.buildAnthropicWebSearchTool({ maxToolCalls: 8 });
    assert.deepStrictEqual(researchTool, {
      type: "web_search_20260318",
      name: "web_search",
      max_uses: 8,
      allowed_callers: ["direct"],
      response_inclusion: "full"
    });

    const body = anthropic.buildAnthropicRequestBody(
      "system instruction",
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "continue" }
      ],
      null,
      { streaming: true, reasoningEffort: "medium" }
    );
    assert.strictEqual(body.model, "claude-sonnet-5");
    assert.strictEqual(body.max_tokens, 2048);
    assert.strictEqual(body.system, "system instruction");
    assert.strictEqual(body.stream, true);
    assert.strictEqual(body.messages[0].role, "user");
    assert.strictEqual(body.messages[1].role, "assistant");
    assert.strictEqual(body.output_config.effort, "medium");

    const researchBody = anthropic.buildAnthropicRequestBody(
      "system instruction",
      [{ role: "user", content: "What changed today?" }],
      null,
      { research: { enabled: true, maxToolCalls: 4 }, reasoningEffort: "high" }
    );
    assert.strictEqual(researchBody.tools.length, 1);
    assert.strictEqual(researchBody.tools[0].type, "web_search_20260318");
    assert.strictEqual(researchBody.tools[0].max_uses, 4);
    assert.deepStrictEqual(researchBody.tools[0].allowed_callers, ["direct"]);
    assert.match(researchBody.system, /Research Mode is active/);
    assert.match(researchBody.system, /Use the provided web_search tool/);

    const extractedResearch = anthropic.extractAnthropicResponse({
      content: [
        {
          type: "server_tool_use",
          id: "srvtoolu_1",
          name: "web_search",
          input: { query: "current example" }
        },
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_1",
          content: [
            {
              type: "web_search_result",
              url: "https://example.com/current",
              title: "Current Example",
              encrypted_content: "encrypted"
            }
          ]
        },
        {
          type: "text",
          text: "Current answer.",
          citations: [
            {
              type: "web_search_result_location",
              url: "https://example.com/current",
              title: "Current Example",
              cited_text: "current evidence",
              encrypted_index: "index"
            }
          ]
        }
      ],
      usage: { server_tool_use: { web_search_requests: 1 } }
    });
    assert.strictEqual(extractedResearch.reply, "Current answer.");
    assert.deepStrictEqual(extractedResearch.research.sources, [
      {
        number: 1,
        title: "Current Example",
        url: "https://example.com/current"
      }
    ]);
    assert.deepStrictEqual(extractedResearch.research.citations, [
      {
        sourceNumber: 1,
        startIndex: 0,
        endIndex: "Current answer.".length
      }
    ]);
    assert.strictEqual(extractedResearch.research.webSearchCalls, 1);

    const legacyBody = anthropic.buildAnthropicRequestBody(
      "",
      [{ role: "user", content: "legacy" }],
      "claude-sonnet-4-5-20250929",
      { reasoningEffort: "high" }
    );
    assert.strictEqual(legacyBody.output_config, undefined);

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
    const thinkingEvent =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"internal reasoning"}}\n\n';
    const event2 =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hel"}}\n\n';
    const event3 =
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n';
    const event4 =
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n';
    const event5 =
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';

    const stream = event1 + thinkingEvent + event2 + event3 + event4 + event5;
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
      reasoningEffort: "low",
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
    assert.strictEqual(request.options.redirect, "error");
    const requestBody = JSON.parse(request.options.body);
    assert.strictEqual(requestBody.stream, true);
    assert.strictEqual(requestBody.system, "system instruction");
    assert.strictEqual(requestBody.output_config.effort, "low");

    assert.strictEqual(result.provider, "anthropic");
    assert.strictEqual(result.model, "claude-sonnet-5");
    assert.strictEqual(result.reply, "Hello");
    assert.deepStrictEqual(deltas, ["Hel", "lo"]);
    assert.strictEqual(result.responseId, "msg_123");
    assert.strictEqual(result.usage.input_tokens, 4);
    assert.strictEqual(result.usage.output_tokens, 3);

    let generateRequest = null;
    const generated = await anthropic.generateChat({
      instructions: "system instruction",
      input: [{ role: "user", content: "deep answer" }],
      reasoningEffort: "high",
      research: { enabled: true, maxToolCalls: 4 },
      fetchImpl: async (url, options) => {
        generateRequest = { url, options };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "msg_generate",
            model: "claude-sonnet-5",
            content: [
              { type: "thinking", thinking: "hidden internal summary" },
              {
                type: "server_tool_use",
                id: "srvtoolu_generate",
                name: "web_search",
                input: { query: "verified answer" }
              },
              {
                type: "web_search_tool_result",
                tool_use_id: "srvtoolu_generate",
                content: [{
                  type: "web_search_result",
                  url: "https://example.com/source",
                  title: "Verified Source",
                  encrypted_content: "encrypted"
                }]
              },
              {
                type: "text",
                text: "Visible answer",
                citations: [{
                  type: "web_search_result_location",
                  url: "https://example.com/source",
                  title: "Verified Source",
                  cited_text: "verified text",
                  encrypted_index: "index"
                }]
              }
            ],
            usage: {
              input_tokens: 3,
              output_tokens: 5,
              server_tool_use: { web_search_requests: 1 }
            }
          })
        };
      }
    });
    assert.strictEqual(generateRequest.options.redirect, "error");
    const generatedRequestBody = JSON.parse(generateRequest.options.body);
    assert.strictEqual(generatedRequestBody.output_config.effort, "high");
    assert.strictEqual(generatedRequestBody.tools[0].type, "web_search_20260318");
    assert.strictEqual(generatedRequestBody.tools[0].max_uses, 4);
    assert.strictEqual(generated.reply, "Visible answer");
    assert.strictEqual(generated.research.sources.length, 1);
    assert.strictEqual(generated.research.sources[0].url, "https://example.com/source");
    assert.deepStrictEqual(generated.research.citations, [{
      sourceNumber: 1,
      startIndex: 0,
      endIndex: "Visible answer".length
    }]);
    assert.strictEqual(generated.research.webSearchCalls, 1);

    const gateway = getGatewayStatus();
    assert.strictEqual(gateway.provider, "anthropic");
    assert.strictEqual(gateway.configured, true);
    assert.strictEqual(gateway.streaming, true);
    assert.strictEqual(gateway.research, true);

    const catalog = providerCatalog({
      ANTHROPIC_API_KEY: "configured"
    });
    const provider = catalog.find((item) => item.id === "anthropic");
    assert(provider);
    assert.strictEqual(provider.chat, true);
    assert.strictEqual(provider.streaming, true);
    assert.strictEqual(provider.reasoningControls, true);
    assert.deepStrictEqual(
      Array.from(provider.supportedEffortLevels),
      ["low", "medium", "high", "xhigh", "max"]
    );
    assert.strictEqual(provider.defaultEffort, "high");
    assert.strictEqual(provider.defaultModel, "claude-sonnet-5");
    assert.strictEqual(provider.adaptiveThinking, true);
    assert.strictEqual(provider.research, true);
    assert.strictEqual(provider.researchTool, "web_search_20260318");
    assert.strictEqual(provider.researchDirectOnly, true);
    assert.strictEqual(
      provider.adapterState,
      "active-sonnet-5-streaming-adaptive-thinking-research"
    );

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

    console.log("PASS Anthropic parity: native SSE streaming, Sonnet 5 effort controls, direct web research with citations, hidden-thinking filtering, redirect hardening, remote stream error handling, and active gateway status.");
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
