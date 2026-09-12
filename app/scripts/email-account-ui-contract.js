const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  ACCOUNT_UI_SCRIPT,
  injectEmailAccountUi
} = require("../email/account-page");

function count(source, needle) {
  return source.split(needle).length - 1;
}

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const indexSource = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const injected = injectEmailAccountUi(indexSource);

  assert.strictEqual(count(injected, ACCOUNT_UI_SCRIPT), 1);
  assert.ok(injected.indexOf(ACCOUNT_UI_SCRIPT) < injected.indexOf("</body>"));
  assert.throws(
    () => injectEmailAccountUi(injected),
    (error) => error?.code === "EMAIL_ACCOUNT_UI_ALREADY_INJECTED"
  );
  assert.throws(
    () => injectEmailAccountUi(indexSource.replace("</body>", "")),
    (error) => error?.code === "EMAIL_ACCOUNT_UI_BODY_MARKER_INVALID"
  );

  const uiSource = fs.readFileSync(path.join(appRoot, "email", "account-ui.js"), "utf8");
  new vm.Script(uiSource, { filename: "email/account-ui.js" });
  assert.match(uiSource, /\/api\/email-verification\/status/);
  assert.match(uiSource, /\/api\/email-verification\/send/);
  assert.match(uiSource, /\/api\/email-verification\/resend/);
  assert.ok(!uiSource.includes("/api/email-verification/consume"));
  assert.ok(!uiSource.includes("location.hash"));
  assert.ok(!uiSource.includes("verificationUrl"));
  assert.ok(!/\btoken\b/i.test(uiSource), "account UI must never handle verification tokens");
  assert.match(uiSource, /textContent/);
  assert.match(uiSource, /aria-live/);
  assert.match(uiSource, /MutationObserver/);
  assert.match(uiSource, /credentials: "same-origin"/);

  console.log("Email account UI contract passed.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
