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

  console.log("PASS connected-apps UI contract: navigation is composed exactly once with model/account UI.");
}

main();
