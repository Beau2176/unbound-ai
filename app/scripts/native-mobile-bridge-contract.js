const assert = require('assert');
const { integrateNativeShellServerSource } = require('../ui/native-shell-server-integration');

const marker = 'app.get("/index.html", (req, res) => {';
const source = `const app = { use() {}, get() {} };\n${marker}\n  return true;\n});\n`;
const integrated = integrateNativeShellServerSource(source);

assert(integrated.includes('native-mobile-bridge.js'), 'native bridge script must be injected');
assert(integrated.includes('req.path !== "/"'), 'homepage route must be intercepted');
assert(integrated.includes('req.path !== "/index.html"'), 'index route must be intercepted');
assert(integrated.includes('Cache-Control'), 'native homepage response must control caching');
assert.strictEqual(
  integrateNativeShellServerSource(integrated),
  integrated,
  'native shell integration must be idempotent'
);

assert.throws(
  () => integrateNativeShellServerSource('const app = {};'),
  (error) => error && error.code === 'NATIVE_SHELL_INDEX_MARKER_INVALID'
);

console.log('UNBOUND AI native mobile bridge contract checks passed.');
