const assert = require("assert");
const {
  MOBILE_LAYOUT_STYLE_ID,
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
    rendered.indexOf(`id="${MOBILE_LAYOUT_STYLE_ID}"`) < rendered.indexOf("</head>"),
    "mobile layout styles should remain inside the document head"
  );
  assert.strictEqual(
    injectMobileLayoutStyles(rendered),
    rendered,
    "mobile layout injection should be idempotent"
  );
  assert.ok(rendered.includes(".topbar-right"), "mobile styles should cover top navigation");
  assert.ok(rendered.includes(".chat-head"), "mobile styles should cover the chat header");
  assert.ok(
    rendered.includes("flex-wrap: nowrap !important"),
    "mobile navigation should stay in one swipeable row"
  );
  assert.ok(
    rendered.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"),
    "mobile product modes should use a responsive grid"
  );
  assert.throws(
    () => injectMobileLayoutStyles("<html><body></body></html>"),
    (error) => error?.code === "MOBILE_LAYOUT_HEAD_MARKER_INVALID"
  );

  console.log("UNBOUND AI mobile-layout contract checks passed.");
}

main();
