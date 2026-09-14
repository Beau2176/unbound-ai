"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  integrateAdultStepUpServerSource
} = require("../security/adult-step-up-server-integration");
const {
  integrateNativeShellServerSource
} = require("../ui/native-shell-server-integration");

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const rawServer = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const integrated = integrateAdultStepUpServerSource(rawServer);

  assert.match(integrated, /ADD COLUMN IF NOT EXISTS adult_step_up_at TIMESTAMPTZ/);
  assert.match(integrated, /ADULT_STEP_UP_TTL_MINUTES \|\| 720/);
  assert.match(integrated, /Math\.max\(5, Math\.min\(1440/);
  assert.match(integrated, /authMethod === "passkey"/);
  assert.match(integrated, /CASE WHEN \$4::boolean THEN NOW\(\) ELSE NULL END/);
  assert.match(integrated, /function buildAdultStepUpState\(req, userId\)/);
  assert.match(integrated, /adult_step_up_at \+ \(\$3::int \* INTERVAL '1 minute'\) > NOW\(\)/);
  assert.match(integrated, /ADULT_DEVICE_AUTH_REQUIRED/);
  assert.match(integrated, /Confirm this device with your passkey before using Adult Mode/);
  assert.match(integrated, /Register a passkey on this account before using Adult Mode/);
  assert.match(integrated, /const adultStepUp = await buildAdultStepUpState\(req, user\.id\)/);
  assert.match(integrated, /return \{ user, ageVerification, adultStepUp \}/);
  assert.match(integrated, /req\.adultStepUp = result\.adultStepUp/);

  assert.match(integrated, /"\/api\/account\/adult-step-up\/status"/);
  assert.match(integrated, /"\/api\/account\/adult-step-up\/options"/);
  assert.match(integrated, /"\/api\/account\/adult-step-up\/verify"/);
  assert.match(integrated, /"\/api\/account\/adult-step-up\/lock"/);
  assert.match(integrated, /Complete hard 18\+ age verification before unlocking Adult Mode/);
  assert.match(integrated, /WHERE user_id = \$1 AND credential_id = \$2/);
  assert.match(integrated, /adult\.step_up_verified/);
  assert.match(integrated, /adult\.step_up_locked/);
  assert.match(integrated, /markCurrentSessionAdultStepUp/);

  assert.strictEqual(
    integrateAdultStepUpServerSource(integrated),
    integrated,
    "Adult step-up server integration must be idempotent"
  );
  new vm.Script(integrated, { filename: "integrated-adult-step-up-server.js" });

  const browser = fs.readFileSync(path.join(appRoot, "adult-step-up.js"), "utf8");
  assert.doesNotThrow(() => new Function(browser), "Adult step-up browser script must parse");
  assert.match(browser, /navigator\.credentials\.get/);
  assert.match(browser, /\/api\/account\/adult-step-up\/status/);
  assert.match(browser, /\/api\/account\/adult-step-up\/options/);
  assert.match(browser, /\/api\/account\/adult-step-up\/verify/);
  assert.match(browser, /document\.addEventListener\("click", interceptAdultClick, true\)/);
  assert.match(browser, /fingerprint\/face data stays on your device/i);
  assert.doesNotMatch(browser, /getUserMedia|MediaRecorder|canvas\.toDataURL/,
    "Adult passkey step-up must never capture biometric media");
  assert.doesNotMatch(browser, /localStorage|sessionStorage/,
    "Adult unlock proof must stay server-side on the signed-in session");
  assert.doesNotMatch(browser, /OPENAI_API_KEY|YOTI_API_KEY|SEGPAY/i,
    "Adult unlock browser code must not contain provider secrets");

  const shellSource = fs.readFileSync(
    path.join(appRoot, "ui", "native-shell-server-integration.js"),
    "utf8"
  );
  assert.match(shellSource, /app\.get\(\"\/adult-step-up\.js\"/);
  assert.match(shellSource, /adult-step-up\.js\?v=095/);
  const shellIntegrated = integrateNativeShellServerSource(integrated);
  assert.match(shellIntegrated, /adult-step-up\.js\?v=095/);

  const startup = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.match(startup, /integrateAdultStepUpServerSource/);
  assert.ok(
    startup.indexOf("integrateAdultStepUpServerSource(integratedSource)") <
      startup.indexOf("integrateNativeShellServerSource(integratedSource)"),
    "Adult step-up server integration must run before homepage/native-shell injection"
  );

  const passkeys = fs.readFileSync(path.join(appRoot, "security", "passkeys.js"), "utf8");
  assert.match(passkeys, /userVerification: "required"/);
  assert.match(passkeys, /requireUserVerification: true/);
  assert.match(passkeys, /biometricDataStored: false/);
  assert.match(passkeys, /privateKeysStored: false/);

  console.log(
    "Adult Mode passkey step-up contract passed: verified 18+ plus session-bound user-verified passkey, expiry, manual lock, and no biometric storage."
  );
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
