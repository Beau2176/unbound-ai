const assert = require("assert");
const anthropic = require("../ai/providers/anthropic");
const google = require("../ai/providers/google");
const local = require("../ai/providers/local");
const { normalizeInputMessages } = require("../ai/providers/provider-utils");
const { providerModelEnv } = require("../ai/model-routing");
const {
  generateChat,
  streamChat,
  getGatewayStatus,
  resolveResearchProvider,
  resolveFallbackProvider,
  resolveProviderForRequest,
  researchModelForProvider,
  fallbackModelForProvider,
  isRetryableProviderError
} = require("../ai/gateway");
const { publicMcpStatus, listMcpTools, callMcpTool } = require("../connections/mcp-client");
const { publicSandboxStatus, createSandboxJob, getSandboxJob } = require("../coding/sandbox-client");

async function main() {
  assert.deepStrictEqual(
    normalizeInputMessages([
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "output_text", text: "hi" }] }
    ]),
    [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" }
    ]
  );

  const trackedKeys = [
    "AI_PROVIDER", "AI_RESEARCH_PROVIDER", "AI_RESEARCH_MODEL",
    "AI_FALLBACK_PROVIDER", "AI_FALLBACK_MODEL",
    "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_MODEL_RESEARCH", "ANTHROPIC_MODEL_FALLBACK",
    "OPENAI_API_KEY", "OPENAI_RESEARCH_MODEL", "AI_MODEL_RESEARCH",
    "GEMINI_API_KEY", "GEMINI_MODEL",
    "UNBOUND_LOCAL_AI_ENDPOINT", "UNBOUND_LOCAL_AI_MODEL", "UNBOUND_LOCAL_AI_API_KEY"
  ];
  const original = Object.fromEntries(trackedKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.ANTHROPIC_API_KEY = "anthropic-secret";
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5";
    let anthropicRequest = null;
    const anthropicFetch = async (url, options) => {
      anthropicRequest = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "msg_123",
          model: "claude-sonnet-5",
          content: [{ type: "text", text: "anthropic reply" }],
          usage: { input_tokens: 4, output_tokens: 3 }
        })
      };
    };
    const anthropicResult = await anthropic.generateChat({
      instructions: "system",
      input: [{ role: "user", content: "hello" }],
      fetchImpl: anthropicFetch
    });
    assert.strictEqual(anthropicRequest.url, anthropic.ANTHROPIC_MESSAGES_URL);
    assert.strictEqual(anthropicRequest.options.headers["x-api-key"], "anthropic-secret");
    assert.strictEqual(anthropicRequest.options.headers["anthropic-version"], "2023-06-01");
    assert.strictEqual(JSON.parse(anthropicRequest.options.body).system, "system");
    assert.strictEqual(anthropicResult.reply, "anthropic reply");
    assert.strictEqual(anthropicResult.provider, "anthropic");

    process.env.GEMINI_API_KEY = "gemini-secret";
    process.env.GEMINI_MODEL = "gemini-3.6-flash";
    let googleRequest = null;
    const googleFetch = async (url, options) => {
      googleRequest = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "gemini reply" }] } }],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3 }
        })
      };
    };
    const googleResult = await google.generateChat({
      instructions: "system",
      input: [{ role: "user", content: "hello" }],
      fetchImpl: googleFetch
    });
    assert(googleRequest.url.includes("gemini-3.6-flash:generateContent"));
    assert.strictEqual(googleRequest.options.headers["x-goog-api-key"], "gemini-secret");
    assert.strictEqual(JSON.parse(googleRequest.options.body).systemInstruction.parts[0].text, "system");
    assert.strictEqual(googleResult.reply, "gemini reply");
    assert.strictEqual(googleResult.provider, "google");

    process.env.UNBOUND_LOCAL_AI_ENDPOINT = "http://127.0.0.1:11434";
    process.env.UNBOUND_LOCAL_AI_MODEL = "private-model";
    process.env.UNBOUND_LOCAL_AI_API_KEY = "local-secret";
    let localRequest = null;
    const localFetch = async (url, options) => {
      localRequest = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "local_1",
          model: "private-model",
          choices: [{ message: { content: "local reply" } }],
          usage: { prompt_tokens: 2, completion_tokens: 2 }
        })
      };
    };
    const localResult = await local.generateChat({
      instructions: "system",
      input: [{ role: "user", content: "hello" }],
      fetchImpl: localFetch
    });
    assert(localRequest.url.endsWith("/v1/chat/completions"));
    assert.strictEqual(localRequest.options.headers.authorization, "Bearer local-secret");
    assert.strictEqual(localResult.reply, "local reply");

    const anthropicModels = providerModelEnv({
      AI_PROVIDER: "anthropic",
      ANTHROPIC_MODEL: "claude-sonnet-5",
      ANTHROPIC_MODEL_FAST: "claude-fast",
      AI_MODEL_FAST: "gpt-should-not-leak"
    });

    assert.strictEqual(anthropicModels.fast, "claude-fast");
    assert.strictEqual(anthropicModels.fallback, "claude-sonnet-5");

    // Research provider routing is opt-in. Normal chat may stay on Gemini/local
    // while Research Mode uses a separately configured sourced provider.
    process.env.AI_PROVIDER = "google";
    process.env.GEMINI_API_KEY = "gemini-secret";
    delete process.env.AI_RESEARCH_PROVIDER;

    let researchStatus = getGatewayStatus();
    assert.strictEqual(researchStatus.provider, "google");
    assert.strictEqual(researchStatus.research, false);
    assert.strictEqual(researchStatus.researchProvider, null);
    assert.strictEqual(
      researchStatus.researchError,
      "active-provider-research-unsupported"
    );

    process.env.AI_RESEARCH_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "anthropic-secret";
    process.env.ANTHROPIC_MODEL_RESEARCH = "claude-sonnet-5-research";

    researchStatus = getGatewayStatus();
    assert.strictEqual(researchStatus.provider, "google");
    assert.strictEqual(researchStatus.configured, true);
    assert.strictEqual(researchStatus.research, true);
    assert.strictEqual(researchStatus.researchProvider, "anthropic");
    assert.strictEqual(researchStatus.researchProviderExplicit, true);
    assert.strictEqual(researchStatus.researchModel, "claude-sonnet-5-research");
    assert.strictEqual(researchStatus.researchError, null);

    const resolvedResearch = resolveResearchProvider({ throwOnError: true });
    assert.strictEqual(resolvedResearch.provider.id, "anthropic");
    assert.strictEqual(resolvedResearch.explicit, true);
    assert.strictEqual(
      researchModelForProvider(resolvedResearch.provider),
      "claude-sonnet-5-research"
    );

    const researchRequestRoute = resolveProviderForRequest({
      research: { enabled: true },
      model: "gemini-3.8-flash"
    });
    assert.strictEqual(researchRequestRoute.provider.id, "anthropic");
    assert.strictEqual(researchRequestRoute.model, "claude-sonnet-5-research");
    assert.strictEqual(researchRequestRoute.researchProviderExplicit, true);

    const normalRequestRoute = resolveProviderForRequest({
      research: null,
      model: "gemini-3.8-flash"
    });
    assert.strictEqual(normalRequestRoute.provider.id, "google");
    assert.strictEqual(normalRequestRoute.model, "gemini-3.8-flash");

    process.env.AI_RESEARCH_PROVIDER = "google";
    researchStatus = getGatewayStatus();
    assert.strictEqual(researchStatus.research, false);
    assert.strictEqual(
      researchStatus.researchError,
      "research-provider-capability-unsupported"
    );
    assert.throws(
      () => resolveResearchProvider({ throwOnError: true }),
      (error) =>
        error &&
        error.code === "AI_RESEARCH_PROVIDER_CAPABILITY_UNSUPPORTED"
    );

    process.env.AI_RESEARCH_PROVIDER = "made-up-provider";
    researchStatus = getGatewayStatus();
    assert.strictEqual(researchStatus.research, false);
    assert.strictEqual(
      researchStatus.researchError,
      "research-provider-unsupported"
    );
    assert.throws(
      () => resolveResearchProvider({ throwOnError: true }),
      (error) => error && error.code === "AI_RESEARCH_PROVIDER_UNSUPPORTED"
    );

    process.env.AI_RESEARCH_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    researchStatus = getGatewayStatus();
    assert.strictEqual(researchStatus.research, false);
    assert.strictEqual(
      researchStatus.researchError,
      "research-provider-not-configured"
    );
    assert.throws(
      () => resolveResearchProvider({ throwOnError: true }),
      (error) => error && error.code === "AI_RESEARCH_PROVIDER_NOT_CONFIGURED"
    );

    process.env.ANTHROPIC_API_KEY = "anthropic-secret";
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.AI_RESEARCH_PROVIDER;
    researchStatus = getGatewayStatus();
    assert.strictEqual(researchStatus.research, true);
    assert.strictEqual(researchStatus.researchProvider, "anthropic");
    assert.strictEqual(researchStatus.researchProviderExplicit, false);
    assert.strictEqual(researchStatus.researchError, null);

    process.env.AI_PROVIDER = "google";
    process.env.AI_RESEARCH_PROVIDER = "anthropic";

    // Failover is explicit and limited to transient primary-provider failure.
    delete process.env.AI_RESEARCH_PROVIDER;
    process.env.AI_FALLBACK_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "anthropic-secret";
    process.env.ANTHROPIC_MODEL_FALLBACK = "claude-sonnet-5-fallback";

    let failoverStatus = getGatewayStatus();
    assert.strictEqual(failoverStatus.provider, "google");
    assert.strictEqual(failoverStatus.failoverEnabled, true);
    assert.strictEqual(failoverStatus.fallbackProvider, "anthropic");
    assert.strictEqual(failoverStatus.fallbackModel, "claude-sonnet-5-fallback");
    assert.strictEqual(failoverStatus.fallbackError, null);

    const fallbackRoute = resolveFallbackProvider({ throwOnError: true });
    assert.strictEqual(fallbackRoute.provider.id, "anthropic");
    assert.strictEqual(
      fallbackModelForProvider(fallbackRoute.provider),
      "claude-sonnet-5-fallback"
    );

    assert.strictEqual(isRetryableProviderError({ statusCode: 429 }), true);
    assert.strictEqual(isRetryableProviderError({ statusCode: 503 }), true);
    assert.strictEqual(isRetryableProviderError({ statusCode: 401 }), false);
    assert.strictEqual(isRetryableProviderError({ statusCode: 400 }), false);
    assert.strictEqual(
      isRetryableProviderError({ code: "ETIMEDOUT", message: "timeout" }),
      true
    );
    assert.strictEqual(
      isRetryableProviderError({
        code: "ANTHROPIC_STREAM_REMOTE_ERROR",
        statusCode: 502,
        message: "Overloaded"
      }),
      true
    );
    assert.strictEqual(
      isRetryableProviderError({
        code: "ANTHROPIC_STREAM_REMOTE_ERROR",
        statusCode: 502,
        message: "Invalid request"
      }),
      false
    );

    const originalGoogleGenerate = google.generateChat;
    const originalAnthropicGenerate = anthropic.generateChat;
    const originalGoogleStream = google.streamChat;
    const originalAnthropicStream = anthropic.streamChat;

    try {
      let fallbackGenerateCalls = 0;
      google.generateChat = async () => {
        const error = new Error("primary unavailable");
        error.code = "GEMINI_REQUEST_FAILED";
        error.statusCode = 503;
        throw error;
      };
      anthropic.generateChat = async (options) => {
        fallbackGenerateCalls += 1;
        assert.strictEqual(options.model, "claude-sonnet-5-fallback");
        return {
          provider: "anthropic",
          model: options.model,
          reply: "fallback answer",
          usage: null,
          responseId: "fallback-generate",
          research: { sources: [], citations: [], webSearchCalls: 0 }
        };
      };

      const failedOver = await generateChat({
        instructions: "system",
        input: [{ role: "user", content: "hello" }],
        model: "gemini-3.8-flash"
      });
      assert.strictEqual(failedOver.provider, "anthropic");
      assert.strictEqual(failedOver.reply, "fallback answer");
      assert.strictEqual(fallbackGenerateCalls, 1);

      fallbackGenerateCalls = 0;
      google.generateChat = async () => {
        const error = new Error("unauthorized");
        error.code = "GEMINI_REQUEST_FAILED";
        error.statusCode = 401;
        throw error;
      };
      await assert.rejects(
        () => generateChat({
          instructions: "system",
          input: [{ role: "user", content: "hello" }],
          model: "gemini-3.8-flash"
        }),
        (error) => error && error.statusCode === 401
      );
      assert.strictEqual(fallbackGenerateCalls, 0);

      let fallbackStreamCalls = 0;
      google.streamChat = async () => {
        const error = new Error("temporary outage");
        error.code = "GEMINI_STREAM_REQUEST_FAILED";
        error.statusCode = 503;
        throw error;
      };
      anthropic.streamChat = async ({ onDelta, model }) => {
        fallbackStreamCalls += 1;
        assert.strictEqual(model, "claude-sonnet-5-fallback");
        if (onDelta) await onDelta("fallback stream");
        return {
          provider: "anthropic",
          model,
          reply: "fallback stream",
          usage: null,
          responseId: "fallback-stream",
          research: { sources: [], citations: [], webSearchCalls: 0 }
        };
      };

      const streamedDeltas = [];
      const streamedFallback = await streamChat({
        instructions: "system",
        input: [{ role: "user", content: "hello" }],
        model: "gemini-3.8-flash",
        onDelta: async (delta) => streamedDeltas.push(delta)
      });
      assert.strictEqual(streamedFallback.provider, "anthropic");
      assert.deepStrictEqual(streamedDeltas, ["fallback stream"]);
      assert.strictEqual(fallbackStreamCalls, 1);

      fallbackStreamCalls = 0;
      google.streamChat = async ({ onDelta }) => {
        if (onDelta) await onDelta("partial");
        const error = new Error("temporary outage after output");
        error.code = "GEMINI_STREAM_REQUEST_FAILED";
        error.statusCode = 503;
        throw error;
      };
      const partialDeltas = [];
      await assert.rejects(
        () => streamChat({
          instructions: "system",
          input: [{ role: "user", content: "hello" }],
          model: "gemini-3.8-flash",
          onDelta: async (delta) => partialDeltas.push(delta)
        }),
        (error) => error && error.statusCode === 503
      );
      assert.deepStrictEqual(partialDeltas, ["partial"]);
      assert.strictEqual(fallbackStreamCalls, 0);
    } finally {
      google.generateChat = originalGoogleGenerate;
      anthropic.generateChat = originalAnthropicGenerate;
      google.streamChat = originalGoogleStream;
      anthropic.streamChat = originalAnthropicStream;
    }

    process.env.AI_FALLBACK_PROVIDER = "google";
    failoverStatus = getGatewayStatus();
    assert.strictEqual(failoverStatus.failoverEnabled, false);
    assert.strictEqual(
      failoverStatus.fallbackError,
      "fallback-provider-same-as-primary"
    );
    assert.throws(
      () => resolveFallbackProvider({ throwOnError: true }),
      (error) => error && error.code === "AI_FALLBACK_PROVIDER_SAME_AS_PRIMARY"
    );

    process.env.AI_FALLBACK_PROVIDER = "made-up-provider";
    failoverStatus = getGatewayStatus();
    assert.strictEqual(failoverStatus.failoverEnabled, false);
    assert.strictEqual(
      failoverStatus.fallbackError,
      "fallback-provider-unsupported"
    );

    process.env.AI_FALLBACK_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    failoverStatus = getGatewayStatus();
    assert.strictEqual(failoverStatus.failoverEnabled, false);
    assert.strictEqual(
      failoverStatus.fallbackError,
      "fallback-provider-not-configured"
    );

    process.env.ANTHROPIC_API_KEY = "anthropic-secret";
    delete process.env.AI_FALLBACK_PROVIDER;
    delete process.env.ANTHROPIC_MODEL_FALLBACK;

    const mcpEnv = {
      UNBOUND_MCP_GATEWAY_URL: "https://mcp.example.test/mcp",
      UNBOUND_MCP_GATEWAY_TOKEN: "mcp-secret"
    };
    assert.strictEqual(publicMcpStatus(mcpEnv).configured, true);
    let mcpRequests = [];
    const mcpFetch = async (url, options) => {
      const body = JSON.parse(options.body);
      mcpRequests.push({ url, options, body });
      if (body.method === "tools/list") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: "2.0",
            id: 1,
            result: {
              tools: [
                { name: "read_data", description: "read", inputSchema: {}, annotations: { readOnlyHint: true } },
                { name: "write_data", description: "write", inputSchema: {}, annotations: { destructiveHint: true } }
              ]
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: "ok" }] }
        })
      };
    };
    const listed = await listMcpTools({ env: mcpEnv, fetchImpl: mcpFetch });
    assert.strictEqual(listed.tools[0].readOnly, true);
    assert.strictEqual(listed.tools[1].approvalRequired, true);
    assert.strictEqual(mcpRequests[0].options.headers["MCP-Protocol-Version"], "2026-07-28");
    assert.strictEqual(mcpRequests[0].options.headers.authorization, "Bearer mcp-secret");
    await assert.rejects(
      () => callMcpTool({ tool: listed.tools[1], arguments: {}, approved: false, env: mcpEnv, fetchImpl: mcpFetch }),
      (error) => error?.code === "MCP_TOOL_APPROVAL_REQUIRED"
    );
    const readResult = await callMcpTool({ tool: listed.tools[0], arguments: {}, env: mcpEnv, fetchImpl: mcpFetch });
    assert.strictEqual(readResult.status, "completed");

    const sandboxEnv = {
      UNBOUND_CODE_SANDBOX_URL: "https://sandbox.example.test/api",
      UNBOUND_CODE_SANDBOX_TOKEN: "sandbox-secret"
    };
    assert.strictEqual(publicSandboxStatus(sandboxEnv).configured, true);
    let sandboxRequest = null;
    const sandboxFetch = async (url, options) => {
      sandboxRequest = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => options.method === "POST"
          ? { id: "job_123", status: "queued" }
          : { id: "job_123", status: "completed", result: { summary: "done" } }
      };
    };
    const created = await createSandboxJob({
      objective: "fix tests",
      repository: "owner/repo",
      branch: "main",
      env: sandboxEnv,
      fetchImpl: sandboxFetch
    });
    assert.strictEqual(created.id, "job_123");
    const createBody = JSON.parse(sandboxRequest.options.body);
    assert.strictEqual(createBody.permissions.productionDeploy, false);
    assert.strictEqual(createBody.permissions.irreversibleActions, false);
    assert.strictEqual(sandboxRequest.options.headers.authorization, "Bearer sandbox-secret");
    const synced = await getSandboxJob("job_123", { env: sandboxEnv, fetchImpl: sandboxFetch });
    assert.strictEqual(synced.status, "completed");

    console.log("PASS provider/MCP/sandbox parity contract: Anthropic, Gemini, local AI, explicit cross-provider Research Mode routing, transient provider failover, provider-aware model routing, stateless MCP approvals, and fail-closed coding sandbox.");
  } finally {
    for (const key of trackedKeys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
