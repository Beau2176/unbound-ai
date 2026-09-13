const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { integrateNativeShellServerSource } = require("../ui/native-shell-server-integration");

const presetPath = path.join(__dirname, "..", "voice-presets.js");
const presetSource = fs.readFileSync(presetPath, "utf8");

assert.doesNotThrow(() => new Function(presetSource), "voice preset enhancer must parse as JavaScript");
assert(presetSource.includes("unboundVoiceListenButton"), "enhancer should attach to the existing Voice / Listen button");
assert(!presetSource.includes("createElement('button');\n    button.id = 'unboundVoiceListenButton'"), "enhancer must not replace the stable Voice / Listen button");
assert(presetSource.includes("Voice 1 — Warm"), "warm voice preset should be present");
assert(presetSource.includes("Voice 2 — Clear"), "clear voice preset should be present");
assert(presetSource.includes("Voice 3 — Deep"), "deep voice preset should be present");
assert(presetSource.includes("Voice 4 — Bright"), "bright voice preset should be present");
assert(presetSource.includes("Voice 5 — Calm"), "calm voice preset should be present");
assert(presetSource.includes("/api/voice/natural-speech"), "natural cloud voices should use the protected server speech route");
assert(presetSource.includes("provider: 'browser'"), "Voice 2 should stay on the clear browser voice");
assert(presetSource.includes("provider: 'cloud'"), "the other temporary voices should use cloud speech");
assert(presetSource.includes("natural") && presetSource.includes("neural"), "Voice 2 should continue preferring high-quality device voices");
assert(presetSource.includes("speechSynthesis"), "Voice 2 browser speech should remain available as the local fallback");
assert(presetSource.includes("Preview selected voice"), "voice preview control should be present");

const integrated = integrateNativeShellServerSource('app.use("/api", createMaintenanceMiddleware());');
assert(integrated.includes('app.get("/voice-presets.js"'), "voice preset script route should be mounted");
assert(integrated.includes('/voice-presets.js?v=105'), "homepage should load the v105 voice preset enhancer");
assert(integrated.includes('injectVoiceListenControl'), "stable Voice / Listen control injection must remain in place");

console.log("UNBOUND AI natural voice preset enhancer contract checks passed.");
