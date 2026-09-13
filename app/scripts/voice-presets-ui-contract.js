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
assert(presetSource.includes("natural") && presetSource.includes("neural"), "natural-sounding voices should be preferred");
assert(presetSource.includes("speechSynthesis"), "browser speech synthesis fallback should be used for temporary presets");
assert(presetSource.includes("Preview selected voice"), "voice preview control should be present");

const integrated = integrateNativeShellServerSource('app.use("/api", createMaintenanceMiddleware());');
assert(integrated.includes('app.get("/voice-presets.js"'), "voice preset script route should be mounted");
assert(integrated.includes('/voice-presets.js?v=104'), "homepage should load the v104 voice preset enhancer");
assert(integrated.includes('injectVoiceListenControl'), "stable Voice / Listen control injection must remain in place");

console.log("UNBOUND AI voice preset enhancer contract checks passed.");
