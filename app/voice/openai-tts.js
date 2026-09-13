const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";

const CLOUD_VOICES = Object.freeze({
  marin: {
    voice: "marin",
    label: "Voice 1 — Marin",
    instructions: "Speak naturally and warmly with relaxed pacing, subtle expression, and a conversational human cadence. Avoid sounding theatrical, robotic, or like an announcer."
  },
  cedar: {
    voice: "cedar",
    label: "Voice 3 — Cedar",
    instructions: "Speak naturally with calm confidence, clear articulation, and an easy conversational pace. Keep the delivery smooth and human without exaggerated performance."
  },
  coral: {
    voice: "coral",
    label: "Voice 4 — Coral",
    instructions: "Speak clearly with a friendly, upbeat, natural tone. Keep the energy light and conversational without sounding synthetic or exaggerated."
  },
  nova: {
    voice: "nova",
    label: "Voice 5 — Nova",
    instructions: "Speak naturally with a polished, expressive, conversational tone. Keep the pacing comfortable and the delivery distinctly human, not robotic or overly dramatic."
  }
});

function normalizePreset(value) {
  const preset = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CLOUD_VOICES, preset) ? preset : "";
}

function normalizeSpeechText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4096);
}

function isOpenAiSpeechConfigured(env = process.env) {
  return Boolean(String(env.OPENAI_API_KEY || "").trim());
}

function publicOpenAiSpeechStatus(env = process.env) {
  return {
    provider: "openai",
    configured: isOpenAiSpeechConfigured(env),
    model: OPENAI_TTS_MODEL,
    presets: Object.entries(CLOUD_VOICES).map(([id, config]) => ({
      id,
      label: config.label
    }))
  };
}

function safeOpenAiSpeechError(error) {
  if (error?.code === "OPENAI_SPEECH_NOT_CONFIGURED") {
    return { statusCode: 503, code: error.code, message: "Natural cloud speech is not configured yet." };
  }
  if (error?.code === "OPENAI_SPEECH_PRESET_INVALID") {
    return { statusCode: 400, code: error.code, message: "That cloud voice is not available." };
  }
  if (error?.code === "OPENAI_SPEECH_TEXT_INVALID") {
    return { statusCode: 400, code: error.code, message: "There is no text to read aloud." };
  }
  if (error?.status === 429 || error?.code === "OPENAI_SPEECH_RATE_LIMITED") {
    return { statusCode: 429, code: "OPENAI_SPEECH_RATE_LIMITED", message: "Natural speech is temporarily busy. Try again shortly." };
  }
  return { statusCode: 502, code: "OPENAI_SPEECH_PROVIDER_FAILED", message: "Natural cloud speech is temporarily unavailable." };
}

async function synthesizeOpenAiSpeech({ text, preset, env = process.env, fetchImpl = fetch } = {}) {
  if (!isOpenAiSpeechConfigured(env)) {
    const error = new Error("OpenAI speech is not configured.");
    error.code = "OPENAI_SPEECH_NOT_CONFIGURED";
    throw error;
  }

  const normalizedPreset = normalizePreset(preset);
  if (!normalizedPreset) {
    const error = new Error("Unsupported OpenAI speech preset.");
    error.code = "OPENAI_SPEECH_PRESET_INVALID";
    throw error;
  }

  const input = normalizeSpeechText(text);
  if (!input) {
    const error = new Error("Speech text is empty.");
    error.code = "OPENAI_SPEECH_TEXT_INVALID";
    throw error;
  }

  const config = CLOUD_VOICES[normalizedPreset];
  const response = await fetchImpl(OPENAI_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${String(env.OPENAI_API_KEY).trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: config.voice,
      input,
      instructions: config.instructions,
      response_format: "mp3",
      speed: 1.0
    })
  });

  if (!response.ok) {
    const error = new Error(`OpenAI speech request failed with status ${response.status}.`);
    error.status = response.status;
    error.code = response.status === 429 ? "OPENAI_SPEECH_RATE_LIMITED" : "OPENAI_SPEECH_PROVIDER_FAILED";
    throw error;
  }

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer || !arrayBuffer.byteLength) {
    const error = new Error("OpenAI speech returned empty audio.");
    error.code = "OPENAI_SPEECH_PROVIDER_FAILED";
    throw error;
  }

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type") || "audio/mpeg",
    provider: "openai",
    model: OPENAI_TTS_MODEL,
    voice: config.voice,
    voiceName: config.label,
    preset: normalizedPreset
  };
}

module.exports = {
  OPENAI_SPEECH_URL,
  OPENAI_TTS_MODEL,
  CLOUD_VOICES,
  normalizePreset,
  normalizeSpeechText,
  isOpenAiSpeechConfigured,
  publicOpenAiSpeechStatus,
  safeOpenAiSpeechError,
  synthesizeOpenAiSpeech
};
