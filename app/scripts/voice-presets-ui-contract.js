const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { integrateNativeShellServerSource } = require("../ui/native-shell-server-integration");

const presetPath = path.join(__dirname, "..", "voice-presets.js");
const presetSource = fs.readFileSync(presetPath, "utf8");

assert.doesNotThrow(() => new Function(presetSource), "voice preset enhancer must parse as JavaScript");
assert(presetSource.includes("unboundVoiceListenButton"), "enhancer should attach to the existing Voice / Listen button");
assert(!presetSource.includes("createElement('button');\n    button.id = 'unboundVoiceListenButton'"), "enhancer must not replace the stable Voice / Listen button");
assert(presetSource.includes("Voice 2 — Clear"), "clear voice preset should be present");
assert(!presetSource.includes("Voice 1 — Warm"), "rejected warm voice should not be exposed");
assert(!presetSource.includes("Voice 3 — Deep"), "cloud voice 3 should stay hidden while cloud speech is rate-limited");
assert(!presetSource.includes("Voice 4 — Bright"), "cloud voice 4 should stay hidden while cloud speech is rate-limited");
assert(!presetSource.includes("Voice 5 — Calm"), "cloud voice 5 should stay hidden while cloud speech is rate-limited");
assert(!presetSource.includes("/api/voice/natural-speech"), "active UI should not depend on the rate-limited cloud speech route");
assert(presetSource.includes("speechSynthesis"), "Voice 2 browser speech should remain available");
assert(presetSource.includes("cachedVoice"), "Voice 2 should cache the resolved browser voice to avoid repeated lookup work");
assert(presetSource.includes("hasActiveSpeech"), "Voice 2 should only cancel speech when speech is actually active");
assert(presetSource.includes("pointerenter") && presetSource.includes("pointerdown"), "Voice 2 should prime its voice list before preview interaction");
assert(presetSource.includes("Preview selected voice"), "voice preview control should be present");

const integrated = integrateNativeShellServerSource('app.use("/api", createMaintenanceMiddleware());');
assert(integrated.includes('app.get("/voice-presets.js"'), "voice preset script route should be mounted");
assert(integrated.includes('/voice-presets.js?v=107'), "homepage should load the v107 voice preset enhancer");
assert(integrated.includes('injectVoiceListenControl'), "stable Voice / Listen control injection must remain in place");

console.log("UNBOUND AI Voice 2 instant-start contract checks passed.");
