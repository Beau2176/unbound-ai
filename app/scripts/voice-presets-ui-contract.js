const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { integrateNativeShellServerSource } = require("../ui/native-shell-server-integration");

const presetPath = path.join(__dirname, "..", "voice-presets.js");
const presetSource = fs.readFileSync(presetPath, "utf8");

assert.doesNotThrow(() => new Function(presetSource), "voice preset enhancer must parse as JavaScript");
assert(presetSource.includes("unboundVoiceListenButton"), "enhancer should attach to the existing Voice / Listen button");
assert(!presetSource.includes("createElement('button');\n    button.id = 'unboundVoiceListenButton'"), "enhancer must not replace the stable Voice / Listen button");
assert(presetSource.includes("Voice 1 — Marin"), "Marin should be exposed as Voice 1");
assert(presetSource.includes("Voice 2 — Clear"), "clear local voice should remain Voice 2");
assert(presetSource.includes("Voice 3 — Cedar"), "Cedar should be exposed as Voice 3");
assert(presetSource.includes("Voice 4 — Coral"), "Coral should be exposed as Voice 4");
assert(presetSource.includes("Voice 5 — Nova"), "Nova should be exposed as Voice 5");
assert(presetSource.includes("/api/voice/natural-speech"), "OpenAI voices should use the protected natural speech route");
assert(presetSource.includes("speechSynthesis"), "Voice 2 browser speech should remain available");
assert(presetSource.includes("cachedVoice"), "Voice 2 should cache the resolved browser voice to avoid repeated lookup work");
assert(presetSource.includes("hasActiveSpeech"), "Voice 2 should only cancel browser speech when speech is active");
assert(presetSource.includes("primeSpeechEngine"), "Voice 2 should prewarm the browser speech engine before playback");
assert(presetSource.includes("warmup.volume = 0"), "Voice 2 engine warmup must remain inaudible");
assert(presetSource.includes("preview.addEventListener('pointerdown'"), "preview should begin on pointerdown instead of waiting for click release");
assert(presetSource.includes("playing Voice 2 — Clear instead"), "cloud voice failures should fall back to Voice 2");
assert(presetSource.includes("error.status === 429"), "OpenAI rate limits should be handled explicitly");
assert(presetSource.includes("credentials: 'same-origin'"), "cloud speech requests should stay same-origin");
assert(!presetSource.includes("OPENAI_API_KEY"), "browser voice code must never contain an OpenAI API key");
assert(presetSource.includes("Preview selected voice"), "voice preview control should be present");

// Auto-Read Replies is opt-in, entitlement-gated, persistent, and intentionally no-spend.
assert(presetSource.includes("unboundVoiceAutoRead"), "Auto-Read Replies control should be mounted in the Voice menu");
assert(presetSource.includes("unbound.voice.autoRead"), "Auto-Read preference should be stored locally after the user opts in");
assert(presetSource.includes("Auto-read new replies: ON"), "Auto-Read should expose a clear enabled state");
assert(presetSource.includes("Auto-read new replies: OFF"), "Auto-Read should expose a clear disabled state");
assert(presetSource.includes("hasAutoReadAccess"), "Auto-Read should verify Voice entitlement before enabling");
assert(presetSource.includes("requires Premium or Ultra Voice access"), "Auto-Read should preserve the paid Voice entitlement gate");
assert(presetSource.includes("MutationObserver"), "Auto-Read should watch for newly completed assistant replies");
assert(presetSource.includes("sendIsBusy()"), "Auto-Read should wait while a reply is still streaming");
assert(presetSource.includes("Response interrupted before completion"), "Auto-Read should skip interrupted replies");
assert(presetSource.includes("handsFreeActive()"), "Auto-Read should yield to Hands-Free Conversation");
assert(presetSource.includes("Auto-read always uses local Voice 2 — Clear"), "Auto-Read should tell the user it is using the no-spend local voice");
const autoReadFunction = presetSource.match(/function speakAutoReadReply\([^)]*\) \{[\s\S]*?\n  \}/);
assert(autoReadFunction, "Auto-Read playback function should exist");
assert(autoReadFunction[0].includes("speakBrowser(text)"), "Auto-Read must use local browser speech");
assert(!autoReadFunction[0].includes("speakSelected"), "Auto-Read must not route through selectable paid cloud voices");
assert(!autoReadFunction[0].includes("CLOUD_SPEECH_URL"), "Auto-Read must not call the cloud speech route");
assert(!autoReadFunction[0].includes("fetch("), "Auto-Read playback itself must not make a network request");

const integrated = integrateNativeShellServerSource('app.use("/api", createMaintenanceMiddleware());');
assert(integrated.includes('app.get("/voice-presets.js"'), "voice preset script route should be mounted");
assert(integrated.includes('/voice-presets.js?v=109'), "homepage should load the v109 voice preset enhancer");
assert(integrated.includes('injectVoiceListenControl'), "stable Voice / Listen control injection must remain in place");

console.log("UNBOUND AI five-voice selector, Voice 2 fallback, and Auto-Read Replies checks passed.");
