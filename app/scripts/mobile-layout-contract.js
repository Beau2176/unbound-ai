const assert = require("assert");
const {
  MOBILE_LAYOUT_STYLE_ID,
  MOBILE_LAYOUT_SCRIPT_ID,
  injectMobileLayoutStyles
} = require("../ui/mobile-layout");

function main() {
  const fixture =
    '<!doctype html><html><head><title>UNBOUND AI</title></head><body><main></main></body></html>';
  const rendered = injectMobileLayoutStyles(fixture);

  assert.ok(
    rendered.includes(`id="${MOBILE_LAYOUT_STYLE_ID}"`),
    "mobile layout styles should be injected"
  );
  assert.ok(
    rendered.includes(`id="${MOBILE_LAYOUT_SCRIPT_ID}"`),
    "mobile menu behavior should be injected"
  );
  assert.ok(
    rendered.indexOf(`id="${MOBILE_LAYOUT_STYLE_ID}"`) < rendered.indexOf("</head>"),
    "mobile layout styles should remain inside the document head"
  );
  assert.ok(
    rendered.indexOf(`id="${MOBILE_LAYOUT_SCRIPT_ID}"`) < rendered.indexOf("</body>"),
    "mobile menu behavior should remain inside the document body"
  );
  assert.strictEqual(
    injectMobileLayoutStyles(rendered),
    rendered,
    "mobile layout injection should be idempotent"
  );

  assert.ok(rendered.includes(".chat-head {\n    display: none !important;"), "mobile chat chrome should be hidden");
  assert.ok(rendered.includes("mobile-menu-button"), "mobile layout should include a compact site menu button");
  assert.ok(rendered.includes("mobile-quickbar"), "mobile chat should include persistent quick controls");
  assert.ok(rendered.includes("mobileChatOptionsButton"), "mobile chat should expose a clear Chat Options action");
  assert.ok(rendered.includes('document.getElementById("newChatButton")'), "New Chat should be promoted into the mobile quick controls");
  assert.ok(rendered.includes('document.getElementById("historyButton")'), "History should be promoted into the mobile quick controls");
  assert.ok(rendered.includes("Current: "), "mobile quick controls should summarize the active mode");
  assert.ok(rendered.includes(".mode-row .hint {\n    display: none !important;"), "desktop keyboard instructions should be hidden on phones");
  assert.ok(rendered.includes("min-height: 44px;"), "mobile interactive controls should retain touch-friendly sizing");
  assert.ok(rendered.includes("overflow: hidden !important;"), "mobile topbar should prevent horizontal spill outside the viewport");
  assert.ok(rendered.includes("max-width: calc(100vw - 16px);"), "mobile menu should remain inside the viewport width");
  assert.ok(rendered.includes('child.matches("button, a")'), "signed-in secondary actions should move into the mobile menu");
  assert.ok(!rendered.includes('a[href="/advertisers.html"], a[href="/connected-apps.html"]'), "secondary navigation links should no longer be forced into the mobile header");
  assert.ok(rendered.includes("Chat options"), "secondary chat controls should move into the dropdown");
  assert.ok(rendered.includes("rememberAndMove"), "mobile controls should be moved without cloning event handlers");

  assert.throws(
    () => injectMobileLayoutStyles("<html><body></body></html>"),
    (error) => error?.code === "MOBILE_LAYOUT_HEAD_MARKER_INVALID"
  );
  assert.throws(
    () => injectMobileLayoutStyles("<html><head></head></html>"),
    (error) => error?.code === "MOBILE_LAYOUT_BODY_MARKER_INVALID"
  );

  console.log("UNBOUND AI mobile-layout v1.02 user-friendly layout checks passed.");
}

main();
