const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { injectVoiceCanonicalText } = require('../ui/voice-canonical-text');
const { integrateNativeShellServerSource } = require('../ui/native-shell-server-integration');

const appRoot = path.join(__dirname, '..');
const indexSource = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
const canonical = injectVoiceCanonicalText(indexSource);

assert(canonical.includes('bubble.dataset.speechText = String(content || "")'), 'assistant bubbles must retain raw answer text');
assert(canonical.includes('assistantBubble.dataset.speechText = reply'), 'streaming bubbles must keep canonical speech text current');
assert(canonical.includes('unbound:assistant-stream'), 'chat streaming must emit dedicated speech events');
assert(canonical.includes('delta: event.delta'), 'mobile voice must receive streaming deltas instead of scraping rendered HTML');
assert(canonical.includes('done: true'), 'chat completion must emit a final speech event');

const mobileVoiceSource = fs.readFileSync(path.join(appRoot, 'voice-mobile-fast-path.js'), 'utf8');
assert.doesNotThrow(() => new vm.Script(mobileVoiceSource), 'mobile voice fast path must parse');
assert(mobileVoiceSource.includes("const MAX_CHUNK = 160"), 'mobile utterances must stay Android-safe');
assert(mobileVoiceSource.includes("const FALLBACK_CHUNK = 96"), 'mobile streaming must start before a long answer completes');
assert(mobileVoiceSource.includes("storageSet(LEGACY_AUTO_READ_STORAGE_KEY, 'false')"), 'legacy MutationObserver auto-reader must stay disabled on mobile');
assert(!mobileVoiceSource.includes('new MutationObserver'), 'mobile voice fast path must not use a broad DOM MutationObserver');
assert(mobileVoiceSource.includes("document.addEventListener('pointerdown', prime"), 'mobile TTS must pre-warm from a user gesture');
assert(mobileVoiceSource.includes("node.dataset.speechText"), 'manual mobile playback must prefer canonical raw answer text');
assert(mobileVoiceSource.includes("event.stopImmediatePropagation()"), 'mobile voice controls must prevent legacy raw-DOM handlers from also firing');
assert(mobileVoiceSource.includes('sawStreamDelta = true'), 'mobile streaming must record that deltas were already consumed');
assert(mobileVoiceSource.includes('detail.done && !sawStreamDelta'), 'completion must not replay the whole answer after streamed speech');

const marker = 'app.use("/api", createMaintenanceMiddleware());';
const minimalServer = `const app = { use() {}, get() {} };\n${marker}\n`;
const integrated = integrateNativeShellServerSource(minimalServer);
assert(integrated.includes('app.get("/voice-mobile-fast-path.js"'), 'server must expose the mobile voice runtime');
assert(integrated.includes('voice-mobile-fast-path.js?v=2'), 'homepage must load the mobile voice runtime');
assert(integrated.includes('injectVoiceCanonicalText'), 'homepage integration must inject canonical speech text');
assert(integrated.includes('/Android|iPhone|iPad|iPod/i.test(userAgent)'), 'mobile user agents must skip the desktop safe bridge');
assert(integrated.includes('__unboundSafeVoiceBridgeMobileSkipped'), 'mobile safe-bridge skip must be explicit and diagnosable');
assert(
  integrated.indexOf('voice-mobile-fast-path.js?v=2') < integrated.indexOf('voice-safe-bridge.js?v=200'),
  'mobile fast path must initialize before the desktop safe bridge request'
);
assert.strictEqual(integrateNativeShellServerSource(integrated), integrated, 'native shell integration must remain idempotent');

console.log('PASS mobile voice fast path: canonical text, progressive speech, TTS prewarm, no legacy observer, no duplicate completion replay, desktop/mobile runtime separation.');
