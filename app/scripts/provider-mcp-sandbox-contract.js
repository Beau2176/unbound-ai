const assert = require("assert");
const anthropic = require("../ai/providers/anthropic");
const google = require("../ai/providers/google");
const local = require("../ai/providers/local");
const { normalizeInputMessages } = require("../ai/providers/provider-utils");
const { providerModelEnv } = require("../ai/model-routing");
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
    "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL",
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

    console.log("PASS provider/MCP/sandbox parity contract: Anthropic, Gemini, local AI, provider-aware routing, stateless MCP approvals, and fail-closed coding sandbox.");
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
