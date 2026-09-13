const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1";
const DEFAULT_VOICE = "marin";
const REALTIME_CALL_URL = "https://api.openai.com/v1/realtime/calls";
const MAX_SDP_CHARS = 90000;

const ALLOWED_VOICES = Object.freeze([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar"
]);

function normalizeVoice(value) {
  const voice = String(value || "").trim().toLowerCase();
  return ALLOWED_VOICES.includes(voice) ? voice : DEFAULT_VOICE;
}

function normalizeModel(value) {
  const model = String(value || "").trim();
  return model || DEFAULT_REALTIME_MODEL;
}

function getRealtimeConfig(env = process.env) {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  return Object.freeze({
    provider: "openai",
    configured: Boolean(apiKey),
    model: normalizeModel(env.OPENAI_REALTIME_MODEL),
    voice: normalizeVoice(env.OPENAI_REALTIME_VOICE),
    apiKey
  });
}

function publicRealtimeStatus(env = process.env) {
  const config = getRealtimeConfig(env);
  return {
    provider: config.provider,
    configured: config.configured,
    model: config.model,
    voice: config.voice,
    transport: "webrtc",
    rawApiKeyExposedToBrowser: false
  };
}

function normalizeSdpOffer(value) {
  const sdp = typeof value === "string" ? value.trim() : "";
  if (!sdp) {
    const error = new Error("A WebRTC SDP offer is required.");
    error.code = "VOICE_SDP_REQUIRED";
    error.statusCode = 400;
    error.publicMessage = "Voice could not start because the browser did not provide a WebRTC offer.";
    throw error;
  }
  if (sdp.length > MAX_SDP_CHARS) {
    const error = new Error("The WebRTC SDP offer is too large.");
    error.code = "VOICE_SDP_TOO_LARGE";
    error.statusCode = 413;
    error.publicMessage = "Voice could not start because the WebRTC offer was too large.";
    throw error;
  }
  if (!/^v=0(?:\r?\n|$)/.test(sdp)) {
    const error = new Error("The WebRTC SDP offer is malformed.");
    error.code = "VOICE_SDP_INVALID";
    error.statusCode = 400;
    error.publicMessage = "Voice could not start because the WebRTC offer was invalid.";
    throw error;
  }
  return sdp;
}

function safeRealtimeProviderError(error) {
  const code = String(error?.code || "");
  if (code.startsWith("VOICE_")) {
    return {
      statusCode: Number(error.statusCode) || 400,
      code,
      message: error.publicMessage || "Voice could not start."
    };
  }
  return {
    statusCode: 502,
    code: "VOICE_PROVIDER_FAILED",
    message: "The voice provider could not start the call. Try again shortly."
  };
}

async function createRealtimeCall({
  sdp,
  instructions,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = getRealtimeConfig(env);
  if (!config.configured) {
    const error = new Error("OPENAI_API_KEY is not configured.");
    error.code = "VOICE_PROVIDER_NOT_CONFIGURED";
    error.statusCode = 503;
    error.publicMessage = "Voice is temporarily unavailable because the AI provider is not configured.";
    throw error;
  }
  if (typeof fetchImpl !== "function") {
    const error = new Error("A fetch implementation is required for Realtime calls.");
    error.code = "VOICE_TRANSPORT_UNAVAILABLE";
    error.statusCode = 503;
    error.publicMessage = "Voice transport is temporarily unavailable.";
    throw error;
  }

  const offer = normalizeSdpOffer(sdp);
  const session = {
    type: "realtime",
    model: config.model,
    output_modalities: ["audio"],
    audio: {
      output: {
        voice: config.voice
      }
    }
  };
  const cleanInstructions = String(instructions || "").trim();
  if (cleanInstructions) {
    session.instructions = cleanInstructions.slice(0, 12000);
  }

  let response;
  try {
    response = await fetchImpl(REALTIME_CALL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sdp: offer,
        session
      })
    });
  } catch (cause) {
    const error = new Error("The Realtime provider request failed.", { cause });
    error.code = "VOICE_PROVIDER_NETWORK_ERROR";
    error.statusCode = 502;
    error.publicMessage = "The voice provider could not be reached. Try again shortly.";
    throw error;
  }

  const answerSdp = await response.text();
  if (!response.ok) {
    const error = new Error(`Realtime provider rejected the call with HTTP ${response.status}.`);
    error.code = "VOICE_PROVIDER_REJECTED";
    error.statusCode = response.status === 429 ? 429 : 502;
    error.publicMessage =
      response.status === 429
        ? "Voice is temporarily at capacity. Try again shortly."
        : "The voice provider could not start the call. Try again shortly.";
    throw error;
  }

  if (!/^v=0(?:\r?\n|$)/.test(String(answerSdp || "").trim())) {
    const error = new Error("Realtime provider returned an invalid SDP answer.");
    error.code = "VOICE_PROVIDER_INVALID_RESPONSE";
    error.statusCode = 502;
    error.publicMessage = "The voice provider returned an invalid connection response.";
    throw error;
  }

  return {
    provider: config.provider,
    model: config.model,
    voice: config.voice,
    sdp: answerSdp,
    callLocation: response.headers?.get?.("location") || null
  };
}

module.exports = {
  DEFAULT_REALTIME_MODEL,
  DEFAULT_VOICE,
  REALTIME_CALL_URL,
  MAX_SDP_CHARS,
  ALLOWED_VOICES,
  normalizeVoice,
  normalizeModel,
  getRealtimeConfig,
  publicRealtimeStatus,
  normalizeSdpOffer,
  safeRealtimeProviderError,
  createRealtimeCall
};
