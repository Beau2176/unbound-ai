const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { integrateNativeShellServerSource } = require('../ui/native-shell-server-integration');

const marker = 'app.get("/index.html", (req, res) => {';
const source = `const app = { use() {}, get() {} };\n${marker}\n  return true;\n});\n`;
const integrated = integrateNativeShellServerSource(source);

assert(integrated.includes('native-mobile-bridge.js'), 'native bridge script must be injected');
assert(integrated.includes('req.path !== "/"'), 'homepage route must be intercepted');
assert(integrated.includes('req.path !== "/index.html"'), 'index route must be intercepted');
assert(integrated.includes('Cache-Control'), 'native homepage response must control caching');
assert(
  integrated.includes('injectInterruptedStreamRecovery'),
  'homepage runtime must apply interrupted-stream recovery before serving the page'
);
assert.strictEqual(
  integrateNativeShellServerSource(integrated),
  integrated,
  'native shell integration must be idempotent'
);

assert.throws(
  () => integrateNativeShellServerSource('const app = {};'),
  (error) => error && error.code === 'NATIVE_SHELL_INDEX_MARKER_INVALID'
);

const bridgePath = path.join(__dirname, '..', 'native-mobile-bridge.js');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
assert.doesNotThrow(() => new Function(bridgeSource), 'native mobile bridge must parse as JavaScript');
assert(bridgeSource.includes("plugins.App.addListener('appUrlOpen'"), 'native bridge must listen for app URL opens');
assert(bridgeSource.includes("url.protocol === 'https:'"), 'native bridge must explicitly require HTTPS for web links');
assert(bridgeSource.includes("url.protocol === 'unbound:'"), 'native bridge must support the controlled UNBOUND custom scheme');
assert(bridgeSource.includes("url.username || url.password || url.port"), 'native bridge must reject credential-bearing or custom-port links');
assert(bridgeSource.includes("parsed.origin !== location.origin"), 'native bridge must reject cross-origin route normalization');
assert(bridgeSource.includes("parsed.pathname !== raw"), 'native bridge must reject normalized traversal-style paths');
assert(bridgeSource.includes("input.length > 2048"), 'native bridge must bound incoming deep-link length');
assert(bridgeSource.includes("url.search.length > 1024 || url.hash.length > 1024"), 'native bridge must bound query and fragment length');
assert(bridgeSource.includes("unbound:deep-link-blocked"), 'blocked native links should emit a local diagnostic event without navigating');
assert(bridgeSource.includes("destination !== location.href"), 'native deep links should avoid pointless same-page reloads');

const routeMatch = bridgeSource.match(/const APP_LINK_ROUTES = new Set\(\[([\s\S]*?)\]\);/);
assert(routeMatch, 'native bridge must define an explicit deep-link route allowlist');
const routeBlock = routeMatch[1];
for (const route of ['/', '/index.html', '/terms.html', '/privacy.html', '/advertisers.html', '/connected-apps.html']) {
  assert(routeBlock.includes(`'${route}'`), `native deep-link allowlist should include ${route}`);
}
for (const blocked of ['/api/', '/admin.html', '/advertising-admin.html']) {
  assert(!routeBlock.includes(blocked), `native deep-link allowlist must not expose ${blocked}`);
}

assert(bridgeSource.includes("['home', '/']"), 'custom UNBOUND deep links should support a home alias');
assert(bridgeSource.includes("['terms', '/terms.html']"), 'custom UNBOUND deep links should support Terms');
assert(bridgeSource.includes("['privacy', '/privacy.html']"), 'custom UNBOUND deep links should support Privacy');
assert(bridgeSource.includes("['apps', '/connected-apps.html']"), 'custom UNBOUND deep links should support connected apps');

console.log('UNBOUND AI native mobile bridge and safe deep-link checks passed.');
