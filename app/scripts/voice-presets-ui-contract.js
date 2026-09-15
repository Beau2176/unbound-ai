const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { integrateNativeShellServerSource } = require("../ui/native-shell-server-integration");

const presetPath = path.join(__dirname, "..", "voice-presets.js");
const presetSource = fs.readFileSync(presetPath, "utf8");

assert.doesNotThrow(() => new Function(presetSource), "device voice enhancer must parse as JavaScript");
assert(presetSource.includes("unboundVoiceListenButton"), "enhancer should attach to the stable Voice / Listen button");
assert(presetSource.includes("unbound.voice.systemVoiceURI"), "selected operating-system voice must be stored locally");
assert(presetSource.includes("speechSynthesis.getVoices()"), "voice picker must enumerate voices exposed by the user's device");
assert(presetSource.includes("Device playback voice"), "voice picker should clearly identify device playback voices");
assert(presetSource.includes("voice?.voiceURI"), "voice selection should use a stable system voice identifier when available");
assert(presetSource.includes("find((item) => item?.default)"), "device default voice should be a safe fallback when no selection is stored");
assert(presetSource.includes("utterance.voice = voice"), "playback must explicitly use the selected device voice");
assert(!presetSource.includes("/api/voice/natural-speech"), "device playback must not call the cloud natural-speech route");
assert(!presetSource.includes("provider: 'openai'"), "device playback picker must not expose cloud provider presets");
assert(!presetSource.includes("utterance.lang ="), "playback must not set language from browser or operating-system locale");
assert(!presetSource.includes("navigator.language"), "playback must not inherit navigator language");
assert(presetSource.includes("Preview selected device voice"), "device voice preview control should be present");
assert(presetSource.includes("unbound:device-voice-changed"), "voice selection changes should notify all playback paths");
assert(presetSource.includes("window.__unboundDeviceVoice"), "shared device voice helper should be exposed for playback integrations");

// Auto-Read Replies remains opt-in, entitlement-gated, persistent, and local/no-spend.
assert(presetSource.includes("unboundVoiceAutoRead"), "Auto-Read Replies control should be mounted in the Voice menu");
assert(presetSource.includes("unbound.voice.autoRead"), "Auto-Read preference should remain stored locally");
assert(presetSource.includes("Auto-read new replies: ON"), "Auto-Read should expose enabled state");
assert(presetSource.includes("Auto-read new replies: OFF"), "Auto-Read should expose disabled state");
assert(presetSource.includes("hasAutoReadAccess"), "Auto-Read should preserve Voice entitlement checks");
assert(presetSource.includes("requires Premium or Ultra Voice access"), "Auto-Read should preserve the paid Voice entitlement gate");
assert(presetSource.includes("MutationObserver"), "Auto-Read should watch for newly completed assistant replies");
assert(presetSource.includes("attributeFilter: ['disabled']"), "Auto-Read should observe the send button busy/ready transition");
assert(presetSource.includes("autoReadSawBusy"), "Auto-Read should require a real send/reply cycle before speaking");
assert(presetSource.includes("Response interrupted before completion"), "Auto-Read should skip interrupted replies");
assert(presetSource.includes("handsFreeActive()"), "Auto-Read should yield to Hands-Free Conversation");
assert(!presetSource.includes("CLOUD_SPEECH_URL"), "Auto-Read and manual device playback must have no cloud speech URL");

const integrated = integrateNativeShellServerSource('app.use("/api", createMaintenanceMiddleware());');
assert(integrated.includes('app.get("/voice-presets.js"'), "device voice script route should be mounted");
assert(integrated.includes('/voice-presets.js?v=109'), "homepage should continue loading the voice enhancer route");
assert(integrated.includes('injectVoiceListenControl'), "stable Voice / Listen control injection must remain in place");

console.log("UNBOUND AI operating-system voice picker and local Auto-Read checks passed.");