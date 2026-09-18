const assert = require("assert");
const fs = require("fs");
const path = require("path");
const openai = require("../ai/providers/openai");
const anthropic = require("../ai/providers/anthropic");
const google = require("../ai/providers/google");
const local = require("../ai/providers/local");
const {
  DEFAULT_PROVIDER_DEADLINE_POLICY,
  getProviderDeadlinePolicy,
  getProviderDeadlineMs,
  createProviderDeadline,
  isTimeoutLikeError,
  providerDeadlineError,
  runWithProviderDeadline
} = require("../ai/provider-deadline");
const {
  getGatewayStatus,
  isRetryableProviderError
} = require("../ai/gateway");

function asyncBody(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield Buffer.from(chunk, "utf8");
    }
  };
}

async function main() {
  const tracked = [
    "AI_PROVIDER",
    "AI_PROVIDER_TIMEOUT_MS",
    "AI_PROVIDER_STREAM_TIMEOUT_MS",
    "AI_RESEARCH_TIMEOUT_MS",
    "AI_FILE_ANALYSIS_TIMEOUT_MS",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "UNBOUND_LOCAL_AI_ENDPOINT",
    "UNBOUND_LOCAL_AI_MODEL"
  ];
  const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

  try {
    assert.deepStrictEqual(
      getProviderDeadlinePolicy({}),
      {
        chatMs: DEFAULT_PROVIDER_DEADLINE_POLICY.chatMs,
        streamMs: DEFAULT_PROVIDER_DEADLINE_POLICY.streamMs,
        researchMs: DEFAULT_PROVIDER_DEADLINE_POLICY.researchMs,
        fileMs: DEFAULT_PROVIDER_DEADLINE_POLICY.fileMs
      }
    );

    const bounded = getProviderDeadlinePolicy({
      AI_PROVIDER_TIMEOUT_MS: "1",
      AI_PROVIDER_STREAM_TIMEOUT_MS: "9999999",
      AI_RESEARCH_TIMEOUT_MS: "7000",
      AI_FILE_ANALYSIS_TIMEOUT_MS: "8000"
    });
    assert.strictEqual(bounded.chatMs, DEFAULT_PROVIDER_DEADLINE_POLICY.minMs);
    assert.strictEqual(bounded.streamMs, DEFAULT_PROVIDER_DEADLINE_POLICY.maxMs);
    assert.strictEqual(bounded.researchMs, 7000);
    assert.strictEqual(bounded.fileMs, 8000);
    assert.strictEqual(
      getProviderDeadlineMs("unknown", { AI_PROVIDER_TIMEOUT_MS: "6000" }),
      6000
    );

    const manual = createProviderDeadline("chat", { timeoutMs: 100 });
    assert.strictEqual(manual.signal.aborted, false);
    assert.strictEqual(manual.timeoutMs, 100);
    manual.cancel();

    assert.strictEqual(
      isTimeoutLikeError(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
      true
    );
    assert.strictEqual(isTimeoutLikeError(new Error("ordinary failure")), false);

    const explicitTimeout = providerDeadlineError(
      "TEST_PROVIDER_TIMEOUT",
      "Test provider",
      5
    );
    assert.strictEqual(explicitTimeout.statusCode, 504);
    assert.strictEqual(isRetryableProviderError(explicitTimeout), true);

    await assert.rejects(
      () => runWithProviderDeadline(
        "chat",
        ({ signal }) => new Promise((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason || new Error("aborted")),
            { once: true }
          );
        }),
        {
          timeoutMs: 5,
          code: "TEST_PROVIDER_TIMEOUT",
          label: "Test provider"
        }
      ),
      (error) =>
        error &&
        error.code === "TEST_PROVIDER_TIMEOUT" &&
        error.statusCode === 504 &&
        error.timeoutMs === 5
    );

    process.env.AI_PROVIDER_TIMEOUT_MS = "6000";
    process.env.AI_PROVIDER_STREAM_TIMEOUT_MS = "7000";
    process.env.AI_RESEARCH_TIMEOUT_MS = "8000";
    process.env.AI_FILE_ANALYSIS_TIMEOUT_MS = "9000";

    process.env.OPENAI_API_KEY = "openai-test-key";
    let openAiRequestOptions = null;
    const fakeOpenAiClient = {
      responses: {
        create: async (request, options) => {
          openAiRequestOptions = options;
          return {
            id: "resp_1",
            model: request.model,
            output_text: "openai ok",
            output: [],
            usage: { input_tokens: 1, output_tokens: 1 }
          };
        }
      }
    };
    const openAiResult = await openai.generateChat({
      instructions: "system",
      input: [{ role: "user", content: "hello" }],
      clientFactory: async () => fakeOpenAiClient
    });
    assert.strictEqual(openAiResult.reply, "openai ok");
    assert.strictEqual(openAiRequestOptions.timeout, 6000);
    assert.strictEqual(openAiRequestOptions.maxRetries, 0);
    assert.ok(openAiRequestOptions.signal instanceof AbortSignal);

    let openAiFileOptions = null;
    const fileClient = {
      responses: {
        create: async (request, options) => {
          openAiFileOptions = options;
          return {
            id: "resp_file",
            model: request.model,
            output_text: "file ok",
            usage: null
          };
        }
      }
    };
    await openai.analyzeFile({
      filename: "note.txt",
      mimeType: "text/plain",
      fileBase64: Buffer.from("hello").toString("base64"),
      prompt: "Summarize",
      clientFactory: async () => fileClient
    });
    assert.strictEqual(openAiFileOptions.timeout, 9000);
    assert.strictEqual(openAiFileOptions.maxRetries, 0);
    assert.ok(openAiFileOptions.signal instanceof AbortSignal);

    process.env.GEMINI_API_KEY = "gemini-test-key";
    let googleSignal = null;
    const googleResult = await google.generateChat({
      instructions: "system",
      input: [{ role: "user", content: "hello" }],
      fetchImpl: async (url, options) => {
        googleSignal = options.signal;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "gemini ok" }] } }]
          })
        };
      }
    });
    assert.strictEqual(googleResult.reply, "gemini ok");
    assert.ok(googleSignal instanceof AbortSignal);

    await assert.rejects(
      () => google.generateChat({
        instructions: "system",
        input: [{ role: "user", content: "timeout" }],
        fetchImpl: async () => {
          throw Object.assign(new Error("request timeout"), { name: "TimeoutError" });
        }
      }),
      (error) =>
        error &&
        error.code === "GEMINI_REQUEST_TIMEOUT" &&
        error.statusCode === 504
    );

    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    const researchSignals = [];
    let anthropicCall = 0;
    const anthropicResearch = await anthropic.generateChat({
      instructions: "system",
      input: [{ role: "user", content: "current info" }],
      research: { enabled: true, maxToolCalls: 2 },
      fetchImpl: async (url, options) => {
        researchSignals.push(options.signal);
        anthropicCall += 1;
        const payload = anthropicCall === 1
          ? {
              id: "paused",
              model: "claude-sonnet-5",
              stop_reason: "pause_turn",
              content: [],
              usage: { input_tokens: 1, output_tokens: 1 }
            }
          : {
              id: "done",
              model: "claude-sonnet-5",
              stop_reason: "end_turn",
              content: [{ type: "text", text: "research ok" }],
              usage: { input_tokens: 1, output_tokens: 1 }
            };
        return {
          ok: true,
          status: 200,
          json: async () => payload
        };
      }
    });
    assert.strictEqual(anthropicResearch.reply, "research ok");
    assert.strictEqual(researchSignals.length, 2);
    assert.ok(researchSignals[0] instanceof AbortSignal);
    assert.strictEqual(researchSignals[0], researchSignals[1]);

    process.env.UNBOUND_LOCAL_AI_ENDPOINT = "http://127.0.0.1:11434";
    process.env.UNBOUND_LOCAL_AI_MODEL = "local-test";
    let localSignal = null;
    const localResult = await local.generateChat({
      instructions: "system",
      input: [{ role: "user", content: "hello" }],
      fetchImpl: async (url, options) => {
        localSignal = options.signal;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "local_1",
            model: "local-test",
            choices: [{ message: { content: "local ok" } }],
            usage: {}
          })
        };
      }
    });
    assert.strictEqual(localResult.reply, "local ok");
    assert.ok(localSignal instanceof AbortSignal);

    let googleStreamSignal = null;
    const streamDeltas = [];
    await google.streamChat({
      instructions: "system",
      input: [{ role: "user", content: "stream" }],
      onDelta: async (delta) => streamDeltas.push(delta),
      fetchImpl: async (url, options) => {
        googleStreamSignal = options.signal;
        return {
          ok: true,
          status: 200,
          body: asyncBody([
            'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n'
          ])
        };
      }
    });
    assert.ok(googleStreamSignal instanceof AbortSignal);
    assert.deepStrictEqual(streamDeltas, ["ok"]);

    process.env.AI_PROVIDER = "google";
    const status = getGatewayStatus();
    assert.deepStrictEqual(status.deadlines, {
      chatMs: 6000,
      streamMs: 7000,
      researchMs: 8000,
      fileMs: 9000
    });

    const selfHealSource = fs.readFileSync(
      path.join(__dirname, "..", "ops", "self-heal.js"),
      "utf8"
    );
    assert.ok(selfHealSource.includes('"ai/provider-deadline.js"'));

    console.log(
      "PASS provider deadlines: bounded policy, real abort deadline, retryable 504 normalization, OpenAI no-retry request options, shared Anthropic research deadline, Gemini/local abort signals, streaming coverage, gateway visibility, and self-heal protection."
    );
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
