const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { integrateEmailVerificationServerSource } = require("../email/server-integration");
const { integrateBillingServerSource } = require("../billing/server-integration");
const { integrateFileAnalysisServerSource } = require("../files/server-integration");
const { integrateImageUnderstandingServerSource } = require("../images/server-integration");
const {
  INTEGRATION_VERSION,
  integrateVoiceServerSource
} = require("../voice/server-integration");

function count(text, needle) {
  return String(text).split(needle).length - 1;
}

function buildIntegratedSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  return integrateVoiceServerSource(
    integrateImageUnderstandingServerSource(
      integrateFileAnalysisServerSource(
        integrateBillingServerSource(
          integrateEmailVerificationServerSource(source)
        )
      )
    )
  );
}

function main() {
  assert.strictEqual(INTEGRATION_VERSION, "v0.70");
  const integrated = buildIntegratedSource();

  assert.strictEqual(count(integrated, 'require("./voice/routes")'), 1);
  assert.strictEqual(count(integrated, 'app.get("/voice.html", sendVoicePage);'), 1);
  assert.strictEqual(count(integrated, 'policy: RATE_LIMIT_POLICY.voiceSessions'), 1);
  assert.strictEqual(count(integrated, 'requireCapability("voice")'), 1);
  assert.strictEqual(count(integrated, 'createVoiceRouter()'), 1);

  const mount = integrated.indexOf('app.use(\n  "/api/voice"');
  assert.ok(mount >= 0);
  const database = integrated.indexOf("requireDatabase", mount);
  const signedIn = integrated.indexOf("requireSignedIn", mount);
  const rateLimit = integrated.indexOf("voiceSessionRateLimit", mount);
  const capability = integrated.indexOf('requireCapability("voice")', mount);
  const router = integrated.indexOf("createVoiceRouter()", mount);
  assert.ok(database > mount);
  assert.ok(signedIn > database);
  assert.ok(rateLimit > signedIn);
  assert.ok(capability > rateLimit);
  assert.ok(router > capability);

  new vm.Script(`(function(require,module,exports,__dirname,__filename){\n${integrated}\n})`);

  const page = fs.readFileSync(path.join(__dirname, "..", "voice.html"), "utf8");
  assert.ok(page.includes("/api/voice/speech"));
  assert.ok(page.includes("/api/chat"));
  assert.ok(page.includes("window.SpeechRecognition || window.webkitSpeechRecognition"));
  assert.ok(page.includes("Boyd Voice V3"));
  assert.ok(page.includes("START VOICE"));
  assert.ok(page.includes("HeyGen API key stays on the server"));

  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptCount = 0;
  while ((match = scriptPattern.exec(page))) {
    const code = String(match[1] || "").trim();
    if (!code) continue;
    new vm.Script(code, { filename: `voice.html#inline-script-${scriptCount + 1}` });
    scriptCount += 1;
  }
  assert.ok(scriptCount >= 1, "Voice page must contain executable browser logic.");

  console.log("UNBOUND AI voice server integration checks passed.");
}

main();
