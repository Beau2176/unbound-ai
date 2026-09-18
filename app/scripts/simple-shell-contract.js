const assert = require("assert");
const {
  SIMPLE_SHELL_STYLE_ID,
  SIMPLE_SHELL_SCRIPT_ID,
  injectSimpleShell
} = require("../ui/simple-shell");

function main() {
  const fixture = '<!doctype html><html><head><title>UNBOUND AI</title></head><body><header><div class="topbar-right"></div></header><section class="chat-head"><div></div><div class="chat-actions"></div></section></body></html>';
  const rendered = injectSimpleShell(fixture);

  assert.ok(rendered.includes(`id="${SIMPLE_SHELL_STYLE_ID}"`), "simple shell styles should be injected");
  assert.ok(rendered.includes(`id="${SIMPLE_SHELL_SCRIPT_ID}"`), "simple shell runtime should be injected");
  assert.ok(rendered.indexOf(`id="${SIMPLE_SHELL_STYLE_ID}"`) < rendered.indexOf("</head>"), "simple shell styles should stay in head");
  assert.ok(rendered.indexOf(`id="${SIMPLE_SHELL_SCRIPT_ID}"`) < rendered.indexOf("</body>"), "simple shell runtime should stay in body");
  assert.strictEqual(injectSimpleShell(rendered), rendered, "simple shell injection should be idempotent");

  assert.ok(rendered.includes("CHAT OPTIONS"), "desktop chat should expose one Chat Options control");
  assert.ok(rendered.includes("Everything powerful stays available without crowding the main chat."), "tools panel should explain progressive disclosure");
  assert.ok(rendered.includes('/voice.html'), "tools should expose voice");
  assert.ok(rendered.includes('/files.html'), "tools should expose files");
  assert.ok(rendered.includes('/images.html'), "tools should expose images");
  assert.ok(rendered.includes('/tasks.html'), "tools should expose tasks");
  assert.ok(rendered.includes('/connected-apps.html'), "tools should expose connected apps");
  assert.ok(rendered.includes('/memory.html'), "tools should expose memory");
  assert.ok(rendered.includes("simpleAccountPanel"), "signed-in account actions should have one account panel");
  assert.ok(rendered.includes("simpleMobileToolsSection"), "mobile menu should expose tools without cluttering chat");
  assert.ok(rendered.includes("Current: "), "desktop and mobile should expose compact mode summaries");
  assert.ok(rendered.includes("overflow-y: auto;"), "desktop panels should be vertically scrollable");
  assert.ok(rendered.includes("scrollbar-gutter: stable;"), "desktop panels should reserve scrollbar space");
  assert.ok(rendered.includes("overscroll-behavior: contain;"), "desktop panel scrolling should stay contained");
  assert.ok(rendered.includes("const availableHeight = Math.max("), "desktop panels should calculate available viewport height");
  assert.ok(rendered.includes('panel.style.maxHeight = availableHeight + "px";'), "desktop panels should cap height to the visible viewport");
  assert.ok(rendered.includes("viewportHeight - top - edge"), "desktop panel height should account for its actual screen position");

  assert.throws(
    () => injectSimpleShell("<html><body></body></html>"),
    (error) => error?.code === "SIMPLE_SHELL_HEAD_MARKER_INVALID"
  );
  assert.throws(
    () => injectSimpleShell("<html><head></head></html>"),
    (error) => error?.code === "SIMPLE_SHELL_BODY_MARKER_INVALID"
  );

  console.log("UNBOUND AI simple-shell progressive-disclosure checks passed.");
}

main();