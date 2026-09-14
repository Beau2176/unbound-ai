const { getGatewayStatus } = require("../ai/gateway");
const { publicHeyGenVoiceStatus } = require("../voice/heygen-tts");
const { publicOpenAiSpeechStatus } = require("../voice/openai-tts");
const { getTokenVaultStatus } = require("../connections/token-vault");
const { publicGitHubStatus } = require("../connections/providers/github");

const CAPABILITY_RUNTIME_VERSION = "v1.0";

function cleanString(value, maxLength = 120) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizePermission(value) {
  const normalized = String(value || "unknown").toLowerCase();
  return ["granted", "prompt", "denied", "unknown"].includes(normalized)
    ? normalized
    : "unknown";
}

function normalizeClientCapabilities(value) {
  const input = value && typeof value === "object" ? value : {};
  const number = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : null;
  };

  return Object.freeze({
    secureContext: Boolean(input.secureContext),
    online: input.online !== false,
    microphoneSupported: Boolean(input.microphoneSupported),
    microphonePermission: normalizePermission(input.microphonePermission),
    speechRecognition: Boolean(input.speechRecognition),
    speechSynthesis: Boolean(input.speechSynthesis),
    audioPlayback: Boolean(input.audioPlayback),
    nativeApp: Boolean(input.nativeApp),
    platform: cleanString(input.platform, 60),
    hardwareConcurrency: number(input.hardwareConcurrency, 1, 256),
    deviceMemoryGb: number(input.deviceMemoryGb, 0.25, 1024),
    networkType: cleanString(input.networkType, 40),
    formsOnPage: number(input.formsOnPage, 0, 1000),
    sameOriginFormInteraction: Boolean(input.sameOriginFormInteraction)
  });
}

function shouldAutoResearch(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  if (/\b(do not|don't|dont|without)\s+(search|browse|look up|research|check the web|use the web)\b/i.test(text)) {
    return false;
  }
  return /\b(latest|current|today|tonight|this week|this month|right now|up[- ]to[- ]date|news|search(?: the)? web|browse(?: the)? web|look (?:it )?up|look online|check online|check the web|research this|find online|verify online|web search|internet search)\b/i.test(text);
}

function getRuntimeCapabilityStatus({ env = process.env, diagnostics = null, clientCapabilities = null } = {}) {
  const gateway = getGatewayStatus();
  const heygen = publicHeyGenVoiceStatus(env);
  const naturalSpeech = publicOpenAiSpeechStatus(env);
  const vault = getTokenVaultStatus(env);
  const github = publicGitHubStatus(env);
  const client = normalizeClientCapabilities(clientCapabilities);

  const voiceServerConfigured = Boolean(heygen.configured || naturalSpeech.configured);
  const voicePlaybackAvailable = Boolean(voiceServerConfigured || client.speechSynthesis || client.audioPlayback);
  const microphoneAvailable = Boolean(client.microphoneSupported || client.speechRecognition);
  const webResearchAvailable = Boolean(gateway.configured && gateway.research);

  return {
    version: CAPABILITY_RUNTIME_VERSION,
    textOutput: true,
    voice: {
      generation: voiceServerConfigured,
      playback: voicePlaybackAvailable,
      heygenConfigured: Boolean(heygen.configured),
      naturalSpeechConfigured: Boolean(naturalSpeech.configured),
      browserSpeechFallback: Boolean(client.speechSynthesis)
    },
    microphoneSpeaker: {
      microphoneAvailable,
      microphonePermission: client.microphonePermission,
      speechRecognition: client.speechRecognition,
      speakerPlayback: Boolean(client.audioPlayback || client.speechSynthesis)
    },
    web: {
      researchAvailable: webResearchAvailable,
      autoResearchRouting: webResearchAvailable,
      arbitraryThirdPartyBrowserControl: false,
      sameOriginFormInteraction: client.sameOriginFormInteraction,
      connectedAppActions: Boolean(github.configured)
    },
    device: {
      browserDiagnostics: true,
      nativeBridge: client.nativeApp,
      platform: client.platform,
      hardwareConcurrency: client.hardwareConcurrency,
      deviceMemoryGb: client.deviceMemoryGb,
      networkType: client.networkType,
      arbitraryOtherAppInspection: false
    },
    health: {
      available: true,
      overall: cleanString(diagnostics?.overall, 20) || "unknown"
    },
    credentials: {
      secureTokenVault: Boolean(vault.configured),
      encryptedAtRest: Boolean(vault.configured),
      rawSecretsExposedToModel: false,
      githubConnectedAppsConfigured: Boolean(github.configured),
      githubWriteActionsEnabled: Boolean(github.writeActionsEnabled)
    }
  };
}

function buildRuntimeCapabilityPrompt(options = {}) {
  const status = getRuntimeCapabilityStatus(options);
  const micState = status.microphoneSpeaker.microphoneAvailable
    ? `available; permission state ${status.microphoneSpeaker.microphonePermission}`
    : "not detected in the current client";

  return `
UNBOUND AI runtime capability awareness:
- Text chat is available.
- Voice generation/playback: ${status.voice.playback ? "available" : "server voice is not configured and no browser speech fallback was reported"}. Server TTS configured: ${status.voice.generation}. Browser speech fallback: ${status.voice.browserSpeechFallback}.
- Microphone/speaker: microphone ${micState}; speaker playback ${status.microphoneSpeaker.speakerPlayback ? "available" : "not reported by the current client"}. Never claim microphone permission is granted unless the permission state says granted.
- Internet/web research: ${status.web.researchAvailable ? "available" : "not configured"}. When the user asks for current/latest information or explicitly asks to search/browse/look something up, the server can automatically enable web research even when another product mode is selected.
- Web-page interaction/form submission: UNBOUND can interact with its own same-origin page controls and authorized Connected Apps when a provider exposes an action. It does NOT currently have unrestricted cross-site browser control over arbitrary third-party pages. Never pretend a form was submitted unless an actual action endpoint confirmed it.
- Device/app inspection: current browser/device capability diagnostics are available. Native-app telemetry may be available through the native bridge. A normal web page cannot inspect arbitrary other installed apps or private OS data; do not claim otherwise.
- Account/server/network health: internal diagnostics are available. Current overall health: ${status.health.overall}.
- Security/credential handling: ${status.credentials.secureTokenVault ? "the encrypted credential/token vault is configured" : "the secure token vault is not configured"}. Raw passwords, API keys, OAuth tokens, and secrets must never be exposed to the language model or echoed to the user. Authorized provider actions may use encrypted credentials server-side.
- Do not answer with blanket statements such as "not available in this text chat" or "cannot verify from here" when a listed UNBOUND platform capability exists. State the real capability and any precise permission/configuration limit instead.
`;
}

function publicRuntimeCapabilities(options = {}) {
  return getRuntimeCapabilityStatus(options);
}

module.exports = {
  CAPABILITY_RUNTIME_VERSION,
  normalizeClientCapabilities,
  shouldAutoResearch,
  getRuntimeCapabilityStatus,
  buildRuntimeCapabilityPrompt,
  publicRuntimeCapabilities
};
