const assert = require("assert");
const { injectVoiceListenControl, VOICE_LISTEN_STYLE_ID, VOICE_LISTEN_SCRIPT_ID } = require("../ui/voice-listen");

const sample = `<!doctype html><html><head><title>UNBOUND AI</title></head><body><form class="composer"><textarea></textarea><button class="send" type="submit">Search Now</button></form></body></html>`;
const result = injectVoiceListenControl(sample);

assert(result.includes(`id="${VOICE_LISTEN_STYLE_ID}"`), "voice/listen styles should be injected");
assert(result.includes(`id="${VOICE_LISTEN_SCRIPT_ID}"`), "voice/listen script should be injected");
assert(result.includes("Voice / Listen"), "visible Voice / Listen label should be present");
assert(result.includes("Voice input"), "voice input action should be present");
assert(result.includes("Listen to last answer"), "listen action should be present");
assert(result.includes("/api/voice/speech"), "existing server voice endpoint should be used");
assert(result.includes("SpeechRecognition") && result.includes("webkitSpeechRecognition"), "browser speech recognition should be supported");
assert(result.includes("recognition.lang = 'en-US'"), "voice input must be locked to U.S. English");
assert(result.includes("utterance.lang = 'en-US'"), "local playback fallback must be locked to U.S. English");
assert(result.includes("/^en[-_]US$/i.test"), "local playback fallback must select only U.S. English voices");
assert(!result.includes("recognition.lang = navigator.language"), "voice input must not inherit a foreign browser locale");
assert.strictEqual(injectVoiceListenControl(result), result, "injection should be idempotent");

console.log("UNBOUND AI Voice / Listen UI v0.99 U.S. English contract checks passed.");
