const DEFAULT_MODEL = "gpt-5.6-luna";

function getModel() {
  return String(process.env.OPENAI_MODEL || process.env.AI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function createClient() {
  const OpenAI = (await import("openai")).default;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function assertConfigured() {
  if (!isConfigured()) {
    const error = new Error("OpenAI provider is not configured.");
    error.code = "AI_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
}

async function generateChat({ instructions, input, model }) {
  assertConfigured();

  const client = await createClient();
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

async function streamChat({ instructions, input, model, onDelta }) {
  assertConfigured();

  const client = await createClient();
  const selectedModel = String(model || getModel()).trim() || getModel();
  const stream = await client.responses.create({
    model: selectedModel,
    instructions,
    input,
    stream: true
  });

  let reply = "";
  let completedResponse = null;

  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      reply += event.delta;
      if (onDelta) {
        await onDelta(event.delta);
      }
    }

    if (event.type === "response.completed" && event.response) {
      completedResponse = event.response;
    }
  }

  return {
    provider: "openai",
    model: completedResponse?.model || selectedModel,
    reply,
    usage: completedResponse?.usage || null,
    responseId: completedResponse?.id || null
  };
}

module.exports = {
  id: "openai",
  getModel,
  isConfigured,
  generateChat,
  streamChat
};
