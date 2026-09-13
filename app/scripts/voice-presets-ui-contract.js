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
assert(presetSource.includes("response.status === 429"), "OpenAI rate limits should be handled explicitly");
assert(presetSource.includes("credentials: 'same-origin'"), "cloud speech requests should stay same-origin");
assert(!presetSource.includes("OPENAI_API_KEY"), "browser voice code must never contain an OpenAI API key");
assert(presetSource.includes("Preview selected voice"), "voice preview control should be present");

const integrated = integrateNativeShellServerSource('app.use("/api", createMaintenanceMiddleware());');
assert(integrated.includes('app.get("/voice-presets.js"'), "voice preset script route should be mounted");
assert(integrated.includes('/voice-presets.js?v=109'), "homepage should load the v109 voice preset enhancer");
assert(integrated.includes('injectVoiceListenControl'), "stable Voice / Listen control injection must remain in place");

console.log("UNBOUND AI five-voice OpenAI selector and Voice 2 fallback checks passed.");
