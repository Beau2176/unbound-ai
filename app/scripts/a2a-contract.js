const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  A2A_PROTOCOL_VERSION,
  A2A_CARD_PATH,
  configuredCardUrl,
  publicA2AStatus,
  requestHeaders,
  publicAgentCard,
  selectInterface,
  buildSendMessageRequest,
  sendA2AMessage
} = require("../connections/a2a-client");
const { publicPlatformCatalog } = require("../platform/registry");

function response(payload, status = 200) {
  const raw = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-length"
          ? String(Buffer.byteLength(raw, "utf8"))
          : null;
      }
    },
    async text() {
      return raw;
    }
  };
}

function baseCard(binding = "HTTP+JSON", interfaceUrl = "https://peer.example.test/a2a") {
  return {
    name: "Peer Agent",
    description: "Test A2A peer",
    version: "1.0.0",
    capabilities: { streaming: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    supportedInterfaces: [{
      url: interfaceUrl,
      protocolBinding: binding,
      protocolVersion: "1.0"
    }],
    skills: [{
      id: "research",
      name: "Research",
      description: "Research a topic",
      tags: ["research"]
    }]
  };
}

async function main() {
  assert.strictEqual(A2A_PROTOCOL_VERSION, "1.0");
  assert.strictEqual(A2A_CARD_PATH, "/.well-known/agent-card.json");

  assert.strictEqual(configuredCardUrl({}), null);
  assert.strictEqual(
    configuredCardUrl({ UNBOUND_A2A_AGENT_CARD_URL: "https://peer.example.test" }).toString(),
    "https://peer.example.test/.well-known/agent-card.json"
  );
  assert.strictEqual(
    configuredCardUrl({ UNBOUND_A2A_AGENT_CARD_URL: "http://peer.example.test" }),
    null
  );

  const status = publicA2AStatus({
    UNBOUND_A2A_AGENT_CARD_URL: "https://peer.example.test/.well-known/agent-card.json"
  });
  assert.strictEqual(status.configured, true);
  assert.strictEqual(status.arbitraryUserEndpointsAllowed, false);
  assert.strictEqual(status.outboundMessagesRequireApproval, true);
  assert.deepStrictEqual(status.supportedBindings, ["HTTP+JSON", "JSONRPC"]);

  const headers = requestHeaders({ UNBOUND_A2A_TOKEN: "secret-token" }, { json: true });
  assert.strictEqual(headers["A2A-Version"], "1.0");
  assert.strictEqual(headers.authorization, "Bearer secret-token");
  assert.strictEqual(headers["content-type"], "application/a2a+json");

  const req = buildSendMessageRequest({ text: "Hello peer" });
  assert.strictEqual(req.message.role, "ROLE_USER");
  assert.strictEqual(req.message.parts[0].text, "Hello peer");
  assert.strictEqual(req.message.parts[0].mediaType, "text/plain");
  assert.deepStrictEqual(req.configuration.acceptedOutputModes, ["text/plain"]);

  const cardUrl = new URL("https://peer.example.test/.well-known/agent-card.json");
  const preferred = {
    ...baseCard("JSONRPC", "https://peer.example.test/rpc"),
    supportedInterfaces: [
      { url: "https://peer.example.test/rpc", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url: "https://peer.example.test/a2a", protocolBinding: "HTTP+JSON", protocolVersion: "1.0" }
    ]
  };
  assert.strictEqual(selectInterface(preferred, cardUrl, {}).binding, "JSONRPC");

  assert.throws(
    () => selectInterface(
      baseCard("HTTP+JSON", "https://other.example.test/a2a"),
      cardUrl,
      {}
    ),
    (error) => error && error.code === "A2A_NO_SUPPORTED_INTERFACE"
  );

  assert.strictEqual(
    selectInterface(
      baseCard("HTTP+JSON", "https://other.example.test/a2a"),
      cardUrl,
      { UNBOUND_A2A_ALLOW_CROSS_ORIGIN_INTERFACE: "true" }
    ).binding,
    "HTTP+JSON"
  );

  let fetchCount = 0;
  await assert.rejects(
    () => sendA2AMessage({
      text: "Do work",
      approved: false,
      env: { UNBOUND_A2A_AGENT_CARD_URL: cardUrl.toString() },
      fetchImpl: async () => {
        fetchCount += 1;
        return response({});
      }
    }),
    (error) => error && error.code === "A2A_APPROVAL_REQUIRED"
  );
  assert.strictEqual(fetchCount, 0);

  const httpCalls = [];
  const httpResult = await sendA2AMessage({
    text: "Research this",
    approved: true,
    env: {
      UNBOUND_A2A_AGENT_CARD_URL: cardUrl.toString(),
      UNBOUND_A2A_TOKEN: "server-secret"
    },
    fetchImpl: async (url, options = {}) => {
      httpCalls.push({ url: String(url), options });
      if (httpCalls.length === 1) return response(baseCard());
      return response({
        task: {
          id: "task-1",
          contextId: "context-1",
          status: { state: "TASK_STATE_SUBMITTED" }
        }
      });
    }
  });
  assert.strictEqual(httpCalls.length, 2);
  assert.strictEqual(httpCalls[0].url, cardUrl.toString());
  assert.strictEqual(httpCalls[1].url, "https://peer.example.test/a2a/message:send");
  assert.strictEqual(httpCalls[1].options.headers["A2A-Version"], "1.0");
  assert.strictEqual(httpCalls[1].options.headers["content-type"], "application/a2a+json");
  assert.strictEqual(httpCalls[1].options.headers.authorization, "Bearer server-secret");
  const httpBody = JSON.parse(httpCalls[1].options.body);
  assert.strictEqual(httpBody.message.role, "ROLE_USER");
  assert.strictEqual(httpBody.message.parts[0].text, "Research this");
  assert.strictEqual(httpResult.binding, "HTTP+JSON");
  assert.strictEqual(httpResult.result.task.id, "task-1");

  const rpcCalls = [];
  const rpcResult = await sendA2AMessage({
    text: "Hello JSON-RPC",
    approved: true,
    env: { UNBOUND_A2A_AGENT_CARD_URL: cardUrl.toString() },
    fetchImpl: async (url, options = {}) => {
      rpcCalls.push({ url: String(url), options });
      if (rpcCalls.length === 1) {
        return response(baseCard("JSONRPC", "https://peer.example.test/rpc"));
      }
      return response({
        jsonrpc: "2.0",
        id: "reply-1",
        result: {
          message: {
            messageId: "agent-message-1",
            contextId: "context-2",
            role: "ROLE_AGENT",
            parts: [{ text: "Hello from peer", mediaType: "text/plain" }]
          }
        }
      });
    }
  });
  assert.strictEqual(rpcCalls[1].url, "https://peer.example.test/rpc");
  const rpcBody = JSON.parse(rpcCalls[1].options.body);
  assert.strictEqual(rpcBody.jsonrpc, "2.0");
  assert.strictEqual(rpcBody.method, "SendMessage");
  assert.strictEqual(rpcBody.params.message.role, "ROLE_USER");
  assert.strictEqual(rpcResult.binding, "JSONRPC");
  assert.strictEqual(rpcResult.result.message.role, "ROLE_AGENT");

  const safeCard = publicAgentCard({
    ...baseCard(),
    securitySchemes: { bearer: { type: "http", bearerFormat: "JWT", credential: "must-not-leak" } }
  });
  assert.deepStrictEqual(safeCard.securitySchemeNames, ["bearer"]);
  assert.strictEqual(JSON.stringify(safeCard).includes("must-not-leak"), false);

  const catalog = publicPlatformCatalog({
    UNBOUND_A2A_AGENT_CARD_URL: cardUrl.toString()
  });
  assert(catalog.protocols.some((protocol) => protocol.id === "a2a" && protocol.implemented === true));
  const peer = catalog.connectors.find((connector) => connector.id === "a2a_peer");
  assert(peer);
  assert.strictEqual(peer.configured, true);
  assert.strictEqual(peer.approvalRequired, true);

  const routes = fs.readFileSync(path.join(__dirname, "..", "platform", "routes.js"), "utf8");
  assert(routes.includes('"/a2a/status"'));
  assert(routes.includes('"/a2a/agent-card"'));
  assert(routes.includes('"/a2a/message"'));
  assert(routes.includes("req.body?.approved === true"));
  assert(!routes.includes("req.body?.endpoint"));
  assert(!routes.includes("req.body?.agentCardUrl"));

  console.log("PASS platform parity wave 6: A2A v1 discovery and approval-gated messaging are fail-closed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
