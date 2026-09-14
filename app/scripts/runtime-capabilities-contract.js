const assert = require("assert");
const {
  CAPABILITY_RUNTIME_VERSION,
  normalizeClientCapabilities,
  shouldAutoResearch,
  buildRuntimeCapabilityPrompt
} = require("../capabilities/runtime");

assert.strictEqual(CAPABILITY_RUNTIME_VERSION, "v1.0");
assert.strictEqual(shouldAutoResearch("Search the web for the latest release"), true);
assert.strictEqual(shouldAutoResearch("What is the news today?"), true);
assert.strictEqual(shouldAutoResearch("Don't search the web; just brainstorm"), false);
assert.strictEqual(shouldAutoResearch("Write a fictional story"), false);

const client = normalizeClientCapabilities({
  secureContext: true,
  online: true,
  microphoneSupported: true,
  microphonePermission: "granted",
  speechRecognition: true,
  speechSynthesis: true,
  audioPlayback: true,
  hardwareConcurrency: 8,
  deviceMemoryGb: 16,
  formsOnPage: 2,
  sameOriginFormInteraction: true
});
assert.strictEqual(client.microphonePermission, "granted");
assert.strictEqual(client.speechRecognition, true);
assert.strictEqual(client.sameOriginFormInteraction, true);

const prompt = buildRuntimeCapabilityPrompt({
  diagnostics: { overall: "green" },
  clientCapabilities: client
});
assert.ok(prompt.includes("Voice generation/playback"));
assert.ok(prompt.includes("Internet/web research"));
assert.ok(prompt.includes("Account/server/network health"));
assert.ok(prompt.includes("Raw passwords"));
assert.ok(prompt.includes("not currently have unrestricted cross-site browser control"));
assert.ok(!prompt.includes("not available in this text chat"));

console.log("UNBOUND runtime capability awareness contract passed.");
