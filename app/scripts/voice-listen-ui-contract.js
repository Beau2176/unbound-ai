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
assert.strictEqual(injectVoiceListenControl(result), result, "injection should be idempotent");

console.log("UNBOUND AI Voice / Listen UI v0.96 contract checks passed.");
