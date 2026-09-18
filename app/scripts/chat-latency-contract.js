const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { normalizeReasoningEffort } = require("../ai/providers/openai");
const { integrateModelRoutingServerSource } = require("../ai/model-routing-server-integration");

const appRoot = path.join(__dirname, "..");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function main() {
  assert.strictEqual(normalizeReasoningEffort("none"), "none");
  assert.strictEqual(normalizeReasoningEffort("LOW"), "low");
  assert.strictEqual(normalizeReasoningEffort("medium"), "medium");
  assert.strictEqual(normalizeReasoningEffort("bogus"), null);

  const providerSource = fs.readFileSync(
    path.join(appRoot, "ai", "providers", "openai.js"),
    "utf8"
  );
  const gatewaySource = fs.readFileSync(
    path.join(appRoot, "ai", "gateway.js"),
    "utf8"
  );
  const serverSource = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const integratedServer = integrateModelRoutingServerSource(serverSource);

  assert.ok(providerSource.includes('let clientPromise = null;'));
  assert.ok(providerSource.includes('if (!clientPromise)'));
  assert.strictEqual(count(providerSource, 'request.reasoning = { effort };'), 2);
  assert.ok(providerSource.includes('reasoningEffort = null'));
  assert.ok(gatewaySource.includes('reasoningEffort = null'));
  assert.match(
    gatewaySource,
    /const primaryOptions\s*=\s*\{[\s\S]*?\breasoningEffort\b[\s\S]*?\};/,
    "Non-streaming gateway requests must forward reasoningEffort."
  );
  assert.match(
    gatewaySource,
    /streamWithProvider\(provider,\s*\{[\s\S]*?\breasoningEffort\b[\s\S]*?\}\s*\)/,
    "Streaming gateway requests must forward reasoningEffort."
  );

  assert.strictEqual(count(integratedServer, 'reasoningEffort,'), 2);
  assert.ok(
    integratedServer.includes(
      'productMode === "research" || depthStyle === "work" ? "low" : "none"'
    ),
    "Sourced/Work chat must keep low reasoning while Casual uses none."
  );
  assert.ok(
    integratedServer.includes('const reasoningEffort = depthStyle === "work" ? "low" : "none";'),
    "Streaming Casual must use none and Work must use low."
  );

  new vm.Script(integratedServer, { filename: "integrated-server-chat-latency.js" });
  new vm.Script(providerSource, { filename: "openai-provider-chat-latency.js" });
  new vm.Script(gatewaySource, { filename: "ai-gateway-chat-latency.js" });

  console.log(
    "PASS chat-latency contract: Casual uses reasoning none, Work/Research use low, reasoning reaches the OpenAI request, and the OpenAI client is reused."
  );
}

main();
