const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const bridgePath = path.join(root, 'voice-safe-bridge.js');
const integrationPath = path.join(root, 'ui', 'native-shell-server-integration.js');

const bridge = fs.readFileSync(bridgePath, 'utf8');
const integration = fs.readFileSync(integrationPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

new vm.Script(bridge, { filename: 'voice-safe-bridge.js' });

assert(bridge.includes('unbound-voice-safe-bridge-v200'), 'safe voice bridge version marker missing');
assert(!bridge.includes('new MutationObserver'), 'safe voice bridge must not use MutationObserver');
assert(!bridge.includes('.observe(document.body'), 'safe voice bridge must not observe the whole page');
assert(bridge.includes('window.setInterval(pollAutoRead, POLL_MS)'), 'safe auto-read polling is missing');
assert(bridge.includes('MAX_UTTERANCE_LENGTH = 220'), 'shared speech chunk limit must stay bounded');
assert(bridge.includes("'.message-sources'"), 'source-list stripping is missing');
assert(bridge.includes("'.inline-citation'"), 'inline-citation stripping is missing');
assert(bridge.includes("'.typing'"), 'typing-indicator stripping is missing');
assert(bridge.includes("storageSet(LEGACY_AUTO_READ_STORAGE_KEY, 'false')"), 'legacy auto-reader must be disabled');
assert(bridge.includes("document.addEventListener('click', handleCapturedClick, true)"), 'manual voice capture handler is missing');
assert(bridge.includes('/api/voice/natural-speech'), 'cloud voice path is missing');
assert(bridge.includes('/api/account/access'), 'voice access check is missing');

assert(integration.includes('app.get("/voice-safe-bridge.js"'), 'safe voice bridge route is missing');
assert(integration.includes('voice-safe-bridge.js?v=200'), 'safe voice bridge script injection is missing');

const safeIndex = integration.indexOf('voice-safe-bridge.js?v=200');
const legacyIndex = integration.indexOf('voice-presets.js?v=109');
assert(safeIndex >= 0 && legacyIndex >= 0 && safeIndex < legacyIndex, 'safe voice bridge must load before legacy voice presets');

console.log('voice safe bridge contract passed');
