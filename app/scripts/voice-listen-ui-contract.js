const assert = require("assert");
const { injectVoiceListenControl, VOICE_LISTEN_STYLE_ID, VOICE_LISTEN_SCRIPT_ID } = require("../ui/voice-listen");

const sample = `<!doctype html><html><head><title>UNBOUND AI</title></head><body><form class="composer"><textarea></textarea><button class="send" type="submit">Search Now</button></form></body></html>`;
const result = injectVoiceListenControl(sample);

assert(result.includes(`id="${VOICE_LISTEN_STYLE_ID}"`), "voice/listen styles should be injected");
assert(result.includes(`id="${VOICE_LISTEN_SCRIPT_ID}"`), "voice/listen script should be injected");
assert(result.includes("Voice / Listen"), "visible Voice / Listen label should be present");
assert(result.includes("Voice input"), "voice input action should be present");
assert(result.includes("Listen to last answer"), "listen action should be present");
assert(result.includes("SpeechRecognition") && result.includes("webkitSpeechRecognition"), "browser speech recognition should be supported");
assert(result.includes("recognition.lang='en-US'"), "voice input must stay locked independently to U.S. English");
assert(!result.includes("recognition.lang=navigator.language"), "voice input must not inherit a foreign browser locale");
assert(result.includes("unbound.voice.systemVoiceURI"), "playback fallback must reuse the selected device voice");
assert(result.includes("speechSynthesis.getVoices()"), "playback fallback must enumerate voices exposed by the device");
assert(result.includes("utterance.voice=voice"), "playback fallback must use the selected device voice");
assert(!result.includes("utterance.lang="), "playback fallback must not force a playback language");
assert(!result.includes("/api/voice/speech"), "playback fallback must stay on-device instead of calling cloud/server TTS");
assert.strictEqual(injectVoiceListenControl(result), result, "injection should be idempotent");

console.log("UNBOUND AI Voice / Listen operating-system playback contract checks passed.");