const DEFAULT_HEYGEN_VOICE_NAME = "Boyd Voice V3";
const HEYGEN_SPEECH_URL = "https://api.heygen.com/v3/voices/speech";
const MAX_SPEECH_CHARS = 5000;

function clampSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return 1;
  return Math.min(Math.max(speed, 0.5), 2);
}

function getHeyGenVoiceConfig(env = process.env) {
  const apiKey = String(env.HEYGEN_API_KEY || "").trim();
  const voiceId = String(env.HEYGEN_VOICE_ID || "").trim();
  const voiceName = String(env.HEYGEN_VOICE_NAME || DEFAULT_HEYGEN_VOICE_NAME).trim();
  const speed = clampSpeed(env.HEYGEN_VOICE_SPEED || 1);
  return Object.freeze({
    provider: "heygen",
    configured: Boolean(apiKey && voiceId),
    apiKey,
    voiceId,
    voiceName: voiceName || DEFAULT_HEYGEN_VOICE_NAME,
    speed,
    locale: "en-US"
  });
}

function publicHeyGenVoiceStatus(env = process.env) {
  const config = getHeyGenVoiceConfig(env);
  return {
    provider: config.provider,
    configured: config.configured,
    voiceName: config.voiceName,
    speed: config.speed,
    locale: config.locale,
    engine: "starfish",
    privateVoiceIdConfigured: Boolean(config.voiceId),
    rawApiKeyExposedToBrowser: false,
    privateVoiceIdExposedToBrowser: false
  };
}

function normalizeSpeechText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    const error = new Error("Speech text is required.");
    error.code = "VOICE_TEXT_REQUIRED";
    error.statusCode = 400;
    error.publicMessage = "There is nothing to speak.";
    throw error;
  }
  if (text.length > MAX_SPEECH_CHARS) {
    const error = new Error("Speech text exceeds HeyGen's request limit.");
    error.code = "VOICE_TEXT_TOO_LONG";
    error.statusCode = 413;
    error.publicMessage = "That answer is too long to speak in one voice response.";
    throw error;
  }
  return text;
}

function parseSpeechPayload(payload) {
  const candidates = [
    payload?.audio_url,
    payload?.url,
    payload?.data?.audio_url,
    payload?.data?.url,
    payload?.audio?.url,
    payload?.data?.audio?.url
  ];
  const audioUrl = candidates.find(
    (value) => typeof value === "string" && /^https:\/\//i.test(value)
  );
  if (!audioUrl) {
    const error = new Error("HeyGen speech response did not contain an audio URL.");
    error.code = "VOICE_PROVIDER_INVALID_RESPONSE";
    error.statusCode = 502;
    error.publicMessage = "The voice provider returned an invalid audio response.";
    throw error;
  }

  return {
    audioUrl,
    durationSeconds: Number(
      payload?.duration ?? payload?.duration_seconds ?? payload?.data?.duration ?? 0
    ) || null,
    wordTimestamps:
      payload?.word_timestamps || payload?.data?.word_timestamps || null
  };
}

function safeHeyGenVoiceError(error) {
  const code = String(error?.code || "");
  if (code.startsWith("VOICE_")) {
    return {
      statusCode: Number(error.statusCode) || 400,
      code,
      message: error.publicMessage || "UNBOUND Voice could not create speech."
    };
  }
  return {
    statusCode: 502,
    code: "VOICE_PROVIDER_FAILED",
    message: "The voice provider could not create speech. Try again shortly."
  };
}

async function synthesizeSpeech({
  text,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = getHeyGenVoiceConfig(env);
  if (!config.configured) {
    const error = new Error("HEYGEN_API_KEY and HEYGEN_VOICE_ID must be configured.");
    error.code = "VOICE_PROVIDER_NOT_CONFIGURED";
    error.statusCode = 503;
    error.publicMessage = "Your UNBOUND voice is selected, but the HeyGen server connection is not fully configured yet.";
    throw error;
  }
  if (typeof fetchImpl !== "function") {
    const error = new Error("A fetch implementation is required for HeyGen speech.");
    error.code = "VOICE_TRANSPORT_UNAVAILABLE";
    error.statusCode = 503;
    error.publicMessage = "Voice transport is temporarily unavailable.";
    throw error;
  }

  const speechText = normalizeSpeechText(text);
  let response;
  try {
    response = await fetchImpl(HEYGEN_SPEECH_URL, {
      method: "POST",
      headers: {
        "X-Api-Key": config.apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": `unbound-voice-${Date.now()}-${Math.random().toString(36).slice(2)}`
      },
      body: JSON.stringify({
        text: speechText,
        voice_id: config.voiceId,
        input_type: "text",
        speed: config.speed,
        language: "en"
      })
    });
  } catch (cause) {
    const error = new Error("HeyGen voice request failed.", { cause });
    error.code = "VOICE_PROVIDER_NETWORK_ERROR";
    error.statusCode = 502;
    error.publicMessage = "The voice provider could not be reached. Try again shortly.";
    throw error;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(`HeyGen rejected speech generation with HTTP ${response.status}.`);
    error.code = response.status === 429 ? "VOICE_PROVIDER_RATE_LIMITED" : "VOICE_PROVIDER_REJECTED";
    error.statusCode = response.status === 429 ? 429 : 502;
    error.publicMessage =
      response.status === 429
        ? "Your UNBOUND voice is temporarily at capacity. Try again shortly."
        : "The voice provider could not create speech. Try again shortly.";
    throw error;
  }

  return {
    provider: config.provider,
    voiceId: config.voiceId,
    voiceName: config.voiceName,
    speed: config.speed,
    ...parseSpeechPayload(payload)
  };
}

module.exports = {
  DEFAULT_HEYGEN_VOICE_NAME,
  HEYGEN_SPEECH_URL,
  MAX_SPEECH_CHARS,
  clampSpeed,
  getHeyGenVoiceConfig,
  publicHeyGenVoiceStatus,
  normalizeSpeechText,
  parseSpeechPayload,
  safeHeyGenVoiceError,
  synthesizeSpeech
};
