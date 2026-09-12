const DEFAULT_MODEL = "gpt-5.6-luna";

function getModel() {
  return String(process.env.OPENAI_MODEL || process.env.AI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function isConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function supportsResearch() {
  return true;
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

function normalizeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractWebResearchMetadata(response) {
  const sources = [];
  const sourceNumbers = new Map();
  const citations = [];
  let webSearchCalls = 0;

  function addSource(rawUrl, rawTitle) {
    const url = normalizeHttpUrl(rawUrl);
    if (!url) return null;

    if (sourceNumbers.has(url)) {
      return sourceNumbers.get(url);
    }

    if (sources.length >= 12) {
      return null;
    }

    const number = sources.length + 1;
    const title = String(rawTitle || "Source").trim().slice(0, 220) || "Source";
    sources.push({ number, title, url });
    sourceNumbers.set(url, number);
    return number;
  }

  for (const item of response?.output || []) {
    if (item?.type === "web_search_call") {
      webSearchCalls += 1;
      const actionSources = Array.isArray(item?.action?.sources)
        ? item.action.sources
        : [];

      for (const source of actionSources) {
        addSource(source?.url || source?.link, source?.title || source?.name);
      }
    }

    if (item?.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (!Array.isArray(content?.annotations)) continue;

      for (const annotation of content.annotations) {
        const citation =
          annotation?.type === "url_citation"
            ? annotation
            : annotation?.url_citation || null;

        if (!citation) continue;

        const sourceNumber = addSource(citation.url, citation.title);
        const startIndex = Number(citation.start_index);
        const endIndex = Number(citation.end_index);

        if (
          sourceNumber &&
          Number.isInteger(startIndex) &&
          Number.isInteger(endIndex) &&
          startIndex >= 0 &&
          endIndex >= startIndex
        ) {
          citations.push({ sourceNumber, startIndex, endIndex });
        }
      }
    }
  }

  citations.sort((a, b) => {
    if (a.endIndex !== b.endIndex) return a.endIndex - b.endIndex;
    return a.sourceNumber - b.sourceNumber;
  });

  return { sources, citations, webSearchCalls };
}

async function generateChat({ instructions, input, model, research = null }) {
  assertConfigured();

  const client = await createClient();
  const selectedModel = String(model || getModel()).trim() || getModel();
  const request = {
    model: selectedModel,
    instructions,
    input
  };

  if (research?.enabled) {
    request.tools = [{ type: "web_search" }];
    request.tool_choice = "required";
    request.include = ["web_search_call.action.sources"];
    request.max_tool_calls = Math.min(
      Math.max(Number(research.maxToolCalls || 4), 1),
      10
    );
  }

  const response = await client.responses.create(request);

  return {
    provider: "openai",
    model: response.model || selectedModel,
    reply: response.output_text || "",
    usage: response.usage || null,
    responseId: response.id || null,
    research: research?.enabled
      ? extractWebResearchMetadata(response)
      : { sources: [], citations: [], webSearchCalls: 0 }
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
    responseId: completedResponse?.id || null,
    research: { sources: [], citations: [], webSearchCalls: 0 }
  };
}

module.exports = {
  id: "openai",
  getModel,
  isConfigured,
  supportsResearch,
  generateChat,
  streamChat
};
