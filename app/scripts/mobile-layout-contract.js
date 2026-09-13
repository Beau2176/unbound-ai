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
  assert.ok(rendered.includes("mobile-menu-button"), "mobile layout should include a compact menu button");
  assert.ok(rendered.includes('a[href="/advertisers.html"], a[href="/connected-apps.html"]'), "Advertise and Apps should remain visible on mobile");
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

  console.log("UNBOUND AI mobile-layout v0.93 contract checks passed.");
}

main();
