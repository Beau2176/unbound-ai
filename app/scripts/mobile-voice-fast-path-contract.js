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
assert(mobileVoiceSource.includes("document.addEventListener('pointerdown', primeFromGesture"), 'mobile TTS must pre-warm from a user gesture without stealing the manual Listen gesture');
assert(mobileVoiceSource.includes("if (action && /Listen to last answer/i"), 'manual Listen must bypass the silent warm-up path');
assert(mobileVoiceSource.includes("try { synth.resume(); } catch (_) {}"), 'Android speech synthesis must explicitly resume before manual playback');
assert(mobileVoiceSource.includes("manualUseDefaultVoice"), 'manual playback must retry with the phone default voice if the selected voice fails');
assert(mobileVoiceSource.includes("Retrying with the phone default voice"), 'manual playback must expose its fallback behavior');
assert(mobileVoiceSource.includes("if (window.speechSynthesis.speaking || window.speechSynthesis.pending)"), 'reset must not issue an unnecessary Android cancel while the speech engine is idle');
assert(mobileVoiceSource.includes("node.dataset.speechText"), 'manual mobile playback must prefer canonical raw answer text');
assert(mobileVoiceSource.includes("event.stopImmediatePropagation()"), 'mobile voice controls must prevent legacy handlers from also firing');
assert(mobileVoiceSource.includes('sawStreamDelta = true'), 'mobile streaming must record that deltas were already consumed');
assert(mobileVoiceSource.includes('detail.done && !sawStreamDelta'), 'completion must not replay the whole answer after streamed speech');
assert(mobileVoiceSource.includes("unbound.voice.systemVoiceURI"), 'mobile playback must reuse the saved device voice');
assert(mobileVoiceSource.includes('speechSynthesis.getVoices()'), 'mobile playback must enumerate device voices');
assert(mobileVoiceSource.includes('JSON.stringify(['), 'mobile device voice key must distinguish multiple entries from the same Android TTS engine');
assert(mobileVoiceSource.includes("String(voice?.lang || '')"), 'mobile voice key must include each selected voice language tag');
assert(mobileVoiceSource.includes('utterance.voice = voice'), 'mobile playback must use the selected device voice');
assert(mobileVoiceSource.includes('utterance.lang = lang'), 'Android Chrome must receive the selected voice language tag to activate the correct voice');
assert(mobileVoiceSource.includes('utterance.voiceURI = uri'), 'Android Chrome should receive the selected voice URI compatibility hint');
assert(!mobileVoiceSource.includes('navigator.language'), 'mobile playback must not inherit the OS/browser language setting');
assert(!mobileVoiceSource.includes('/api/voice/natural-speech'), 'mobile playback must remain local and not call cloud TTS');
assert(mobileVoiceSource.includes('unbound:device-voice-changed'), 'mobile playback should refresh when the selected device voice changes');

const marker = 'app.use("/api", createMaintenanceMiddleware());';
const minimalServer = `const app = { use() {}, get() {} };\n${marker}\n`;
const integrated = integrateNativeShellServerSource(minimalServer);
assert(integrated.includes('app.get("/voice-mobile-fast-path.js"'), 'server must expose the mobile voice runtime');
assert(integrated.includes('voice-mobile-fast-path.js?v=3'), 'homepage must load the mobile voice runtime');
assert(integrated.includes('injectVoiceCanonicalText'), 'homepage integration must inject canonical speech text');
assert(integrated.includes('/Android|iPhone|iPad|iPod/i.test(userAgent)'), 'mobile user agents must skip the desktop safe bridge');
assert(integrated.includes('__unboundSafeVoiceBridgeMobileSkipped'), 'mobile safe-bridge skip must be explicit and diagnosable');
assert(
  integrated.indexOf('voice-mobile-fast-path.js?v=3') < integrated.indexOf('voice-safe-bridge.js?v=200'),
  'mobile fast path must initialize before the desktop safe bridge request'
);
assert.strictEqual(integrateNativeShellServerSource(integrated), integrated, 'native shell integration must remain idempotent');

console.log('PASS mobile voice fast path: canonical text, Android-safe manual Listen, default-voice retry, progressive speech, and no duplicate completion replay.');