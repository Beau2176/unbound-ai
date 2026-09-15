const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  integrateModelRoutingServerSource
} = require("../ai/model-routing-server-integration");
const {
  INTEGRATION_VERSION,
  integrateChatLatencyServerSource
} = require("../ai/chat-latency-server-integration");

const appRoot = path.join(__dirname, "..");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v1.00");

  const serverSource = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const routedSource = integrateModelRoutingServerSource(serverSource);
  const integrated = integrateChatLatencyServerSource(routedSource);

  assert.ok(
    integrated.includes("const user = req.user || (await findSessionUser(req));"),
    "Chat access checks should reuse a user already resolved earlier in the request."
  );
  assert.ok(
    integrated.includes("const access = req.accountAccess || (await buildAccountAccess(user));"),
    "Capability checks should reuse the request-scoped access bundle."
  );
  assert.ok(
    integrated.includes("req.accountAccess = access;"),
    "Capability checks should cache the access bundle for the rest of the request."
  );
  assert.ok(
    integrated.includes("req.accountAccess?.ageVerification || (await buildAgeVerificationState(user.id))"),
    "Adult checks should reuse age verification already present in account access."
  );
  assert.ok(
    integrated.includes("const user = req.user || (await findSessionUser(req));\n  if (user) req.user = user;"),
    "Persistent chat should reuse the signed-in user resolved by rate limiting/access checks."
  );
  assert.strictEqual(
    count(integrated, "? (req.accountAccess || (await buildAccountAccess(req.user)))"),
    2,
    "Both generated model-routing paths should reuse the request-scoped access bundle."
  );
  assert.strictEqual(
    count(integrated, "const multiModelAccess = req.user ? await buildAccountAccess(req.user) : null;"),
    0,
    "No model-routing path should rebuild account access unconditionally."
  );

  new vm.Script(integrated, { filename: "integrated-server-chat-access-cache.js" });

  const startup = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.ok(startup.includes('require("./ai/chat-latency-server-integration")'));
  assert.ok(startup.includes("integrateChatLatencyServerSource(integratedSource)"));
  assert.ok(
    startup.indexOf("integrateChatLatencyServerSource(integratedSource)") >
      startup.indexOf("integrateModelRoutingServerSource(integratedSource)"),
    "Chat latency integration must run after model routing so it can cache generated access lookups."
  );

  console.log(
    "PASS chat access cache contract: request-scoped user/access reuse, adult verification reuse, persistent-chat reuse, and multi-model access reuse."
  );
}

main();
