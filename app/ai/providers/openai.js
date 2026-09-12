const DEFAULT_MODEL = "gpt-5.6-luna";

function getModel() {
  return String(process.env.OPENAI_MODEL || process.env.AI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function generateChat({ instructions, input, model }) {
  if (!isConfigured()) {
    const error = new Error("OpenAI provider is not configured.");
    error.code = "AI_PROVIDER_NOT_CONFIGURED";
    throw error;
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const selectedModel = String(model || getModel()).trim() || getModel();

  const response = await client.responses.create({
    model: selectedModel,
    instructions,
    input
  });

  return {
    provider: "openai",
    model: response.model || selectedModel,
    reply: response.output_text || "",
    usage: response.usage || null,
    responseId: response.id || null
  };
}

module.exports = {
  id: "openai",
  getModel,
  isConfigured,
  generateChat
};
