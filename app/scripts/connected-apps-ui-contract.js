const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  CONNECTED_APPS_LINK,
  injectConnectedAppsUi
} = require("../connections/ui");
const { injectEmailAccountUi } = require("../email/account-page");

function count(source, needle) {
  return String(source).split(needle).length - 1;
}

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const connected = injectConnectedAppsUi(source);
  assert.strictEqual(count(connected, CONNECTED_APPS_LINK), 1);
  assert.strictEqual(injectConnectedAppsUi(connected), connected);

  const fullyComposed = injectEmailAccountUi(source);
  assert.strictEqual(count(fullyComposed, CONNECTED_APPS_LINK), 1);
  assert.strictEqual(count(fullyComposed, 'id="modelProfileSelect"'), 1);
  assert.strictEqual(count(fullyComposed, '<script src="/email-account-ui.js" defer></script>'), 1);
  assert.ok(fullyComposed.includes('href="/connected-apps.html">APPS</a>'));

  assert.throws(
    () => injectConnectedAppsUi(source.replace('href="/advertisers.html"', 'href="/sponsors.html"')),
    (error) => error?.code === "CONNECTED_APPS_UI_MARKER_INVALID"
  );

  const page = fs.readFileSync(path.join(appRoot, "connected-apps.html"), "utf8");
  assert.ok(page.includes("GitHub setup diagnostics"));
  assert.ok(page.includes('id="githubChecklist"'));
  assert.ok(page.includes('id="callbackUrl"'));
  assert.ok(page.includes('id="copyCallbackButton"'));
  assert.ok(page.includes('id="nextAction"'));
  assert.ok(page.includes("tokenEncryptionConfigured"));
  assert.ok(page.includes("appRegistrationVerified"));
  assert.ok(page.includes("readOnlyPermissionsVerified"));
  assert.ok(page.includes("/api/connections/github/callback"));
  assert.ok(page.includes("Never paste the Client Secret into chat."));
  assert.ok(!page.includes("GITHUB_APP_CLIENT_SECRET"));
  assert.ok(!page.includes("CONNECTED_APPS_TOKEN_KEY"));
  assert.ok(!page.includes("access_token"));
  assert.ok(!page.includes("refresh_token"));

  console.log("PASS connected-apps UI contract: navigation and setup diagnostics are composed safely without browser secrets.");
}

main();
