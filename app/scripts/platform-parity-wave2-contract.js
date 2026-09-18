const assert = require("assert");
const fs = require("fs");
const path = require("path");
const anthropic = require("../ai/providers/anthropic");
const gemini = require("../ai/providers/gemini");
const local = require("../ai/providers/local");
const { listGatewayProviders } = require("../ai/gateway");
const { resolveChatModel } = require("../ai/model-routing");
const {
  MCP_PROTOCOL_VERSION,
  listTools,
  callReadOnlyTool,
  publicMcpStatus
} = require("../platform/mcp-client");
const {
  submitCodingJob,
  publicSandboxStatus
} = require("../platform/sandbox-client");
const { providerCatalog, workspaceStatus } = require("../platform/registry");

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

async function main() {
  let anthropicRequest = null;
  const anthropicResult = await anthropic.generateChat({
    instructions: "system",
    input: [{ role: "user", content: "hello" }],
    env: { ANTHROPIC_API_KEY: "a-key", ANTHROPIC_MODEL: "claude-test" },
    fetchImpl: async (url, options) => {
      anthropicRequest = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({
        id: "msg_1",
        model: "claude-test",
        content: [{ type: "text", text: "anthropic-ok" }],
        usage: { input_tokens: 10, output_tokens: 2 }
      });
    }
  });
  assert.strictEqual(anthropicResult.reply, "anthropic-ok");
  assert.strictEqual(anthropicRequest.url, "https://api.anthropic.com/v1/messages");
  assert.strictEqual(anthropicRequest.options.headers["x-api-key"], "a-key");
  assert.strictEqual(anthropicRequest.body.model, "claude-test");

  let geminiRequest = null;
  const geminiResult = await gemini.generateChat({
    instructions: "system",
    input: [{ role: "user", content: "hello" }],
    env: { GEMINI_API_KEY: "g-key", GEMINI_MODEL: "gemini-test" },
    fetchImpl: async (url, options) => {
      geminiRequest = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({
        responseId: "gem-1",
        modelVersion: "gemini-test",
        candidates: [{ content: { parts: [{ text: "gemini-ok" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 }
      });
    }
  });
  assert.strictEqual(geminiResult.reply, "gemini-ok");
  assert(geminiRequest.url.includes("/models/gemini-test:generateContent"));
  assert.strictEqual(geminiRequest.options.headers["x-goog-api-key"], "g-key");
  assert.strictEqual(geminiRequest.body.systemInstruction.parts[0].text, "system");

  let localRequest = null;
  const localResult = await local.generateChat({
    instructions: "system",
    input: [{ role: "user", content: "hello" }],
    env: {
      UNBOUND_LOCAL_AI_ENDPOINT: "https://local.example.test",
      UNBOUND_LOCAL_AI_MODEL: "local-test",
      UNBOUND_LOCAL_AI_TOKEN: "local-token"
    },
    fetchImpl: async (url, options) => {
      localRequest = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({
        id: "local-1",
        model: "local-test",
        choices: [{ message: { content: "local-ok" } }],
        usage: { prompt_tokens: 4, completion_tokens: 2 }
      });
    }
  });
  assert.strictEqual(localResult.reply, "local-ok");
  assert.strictEqual(localRequest.url, "https://local.example.test/v1/chat/completions");
  assert.strictEqual(localRequest.options.headers.authorization, "Bearer local-token");
  assert.strictEqual(localRequest.body.messages[0].role, "system");

  const routed = resolveChatModel({
    requestedProfile: "auto",
    depthStyle: "work",
    defaultModel: "gpt-default",
    defaultProvider: "openai",
    enabled: true,
    env: {
      AI_PROVIDER: "openai",
      AI_PROVIDER_DEEP: "anthropic",
      AI_MODEL_DEEP: "claude-deep"
    }
  });
  assert.strictEqual(routed.profile, "deep");
  assert.strictEqual(routed.provider, "anthropic");
  assert.strictEqual(routed.model, "claude-deep");

  const providerIds = listGatewayProviders().map((item) => item.id).sort();
  assert.deepStrictEqual(providerIds, ["anthropic", "gemini", "local", "openai"]);

  const mcpEnv = {
    UNBOUND_MCP_GATEWAY_URL: "https://mcp.example.test/mcp",
    UNBOUND_MCP_GATEWAY_TOKEN: "mcp-token",
    UNBOUND_MCP_READ_ONLY_TOOLS: "search,lookup"
  };
  let listRequest = null;
  const tools = await listTools({
    env: mcpEnv,
    fetchImpl: async (url, options) => {
      listRequest = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({ jsonrpc: "2.0", id: "x", result: { tools: [{ name: "search", description: "Search" }] } });
    }
  });
  assert.strictEqual(tools[0].name, "search");
  assert.strictEqual(listRequest.options.headers["mcp-protocol-version"], MCP_PROTOCOL_VERSION);
  assert.strictEqual(listRequest.options.headers["mcp-method"], "tools/list");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(listRequest.options.headers, "mcp-name"), false);
  assert.strictEqual(
    listRequest.body.params._meta["io.modelcontextprotocol/protocolVersion"],
    MCP_PROTOCOL_VERSION
  );

  let callRequest = null;
  const callResult = await callReadOnlyTool("search", { q: "unbound" }, {
    env: mcpEnv,
    fetchImpl: async (url, options) => {
      callRequest = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({ jsonrpc: "2.0", id: "y", result: { content: [{ type: "text", text: "found" }] } });
    }
  });
  assert(callResult.content);
  assert.strictEqual(callRequest.options.headers["mcp-method"], "tools/call");
  assert.strictEqual(callRequest.options.headers["mcp-name"], "search");
  assert.strictEqual(callRequest.body.params.name, "search");
  await assert.rejects(
    () => callReadOnlyTool("delete_everything", {}, { env: mcpEnv, fetchImpl: async () => jsonResponse({}) }),
    (error) => error?.code === "MCP_TOOL_NOT_READ_ONLY_ALLOWED"
  );
  assert.strictEqual(publicMcpStatus(mcpEnv).browserSuppliedEndpointsAccepted, false);

  let sandboxRequest = null;
  const submitted = await submitCodingJob({
    objective: "Run tests",
    userId: "42",
    env: {
      UNBOUND_CODE_SANDBOX_URL: "https://sandbox.example.test",
      UNBOUND_CODE_SANDBOX_TOKEN: "sandbox-token"
    },
    fetchImpl: async (url, options) => {
      sandboxRequest = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({ id: "sandbox-job-1", status: "queued" });
    }
  });
  assert.strictEqual(submitted.providerJobId, "sandbox-job-1");
  assert.strictEqual(sandboxRequest.url, "https://sandbox.example.test/v1/jobs");
  assert.strictEqual(sandboxRequest.options.headers.authorization, "Bearer sandbox-token");
  assert.strictEqual(sandboxRequest.body.permissions.irreversibleExternalActions, false);
  assert.strictEqual(publicSandboxStatus({
    UNBOUND_CODE_SANDBOX_URL: "https://sandbox.example.test",
    UNBOUND_CODE_SANDBOX_TOKEN: "sandbox-token"
  }).mainAppServerExecutionAllowed, false);

  const catalogEnv = {
    ANTHROPIC_API_KEY: "a",
    ANTHROPIC_MODEL: "claude",
    GEMINI_API_KEY: "g",
    GEMINI_MODEL: "gemini",
    UNBOUND_LOCAL_AI_ENDPOINT: "https://local.example.test",
    UNBOUND_LOCAL_AI_MODEL: "local",
    UNBOUND_CODE_SANDBOX_URL: "https://sandbox.example.test",
    UNBOUND_CODE_SANDBOX_TOKEN: "token"
  };
  assert.strictEqual(providerCatalog(catalogEnv).find((item) => item.id === "anthropic").configured, true);
  assert.strictEqual(providerCatalog(catalogEnv).find((item) => item.id === "google").configured, true);
  assert.strictEqual(workspaceStatus(catalogEnv).codeWorkspace, true);

  const routesSource = fs.readFileSync(path.join(__dirname, "..", "platform", "routes.js"), "utf8");
  assert(routesSource.includes('router.get("/mcp/status"'));
  assert(routesSource.includes('router.post("/mcp/tools/:name/call"'));
  assert(routesSource.includes("callReadOnlyTool"));
  assert(routesSource.includes("submitCodingJob"));
  assert(routesSource.includes("Coding workspace job submitted to the isolated sandbox provider."));

  console.log("PASS platform parity wave 2: Anthropic, Gemini, local AI, provider routing, MCP 2026-07-28, and isolated coding sandbox.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
