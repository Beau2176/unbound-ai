from pathlib import Path

server_path = Path("app/server.js")
server = server_path.read_text()


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


server = replace_once(
    server,
    '- This server does not yet provide external web/research tools to the model. Never claim external research, browsing, source verification, or tool use unless those capabilities are actually added and invoked.',
    '- Use external research only when research tools are actually provided for the current request. Never claim browsing, verification, or tool use unless it actually occurred.',
    "work prompt",
)

work_tail = '''- Use external research only when research tools are actually provided for the current request. Never claim browsing, verification, or tool use unless it actually occurred.\n`;\n\napp.disable("x-powered-by");'''
research_tail = '''- Use external research only when research tools are actually provided for the current request. Never claim browsing, verification, or tool use unless it actually occurred.\n`;\n\nconst RESEARCH_MODE_PROMPT = `\nProduct mode: RESEARCH MODE.\n- Use the provided web-search capability before answering.\n- Prefer primary, official, recent, and directly relevant sources when they are available.\n- Cross-check important or disputed claims across more than one source when practical.\n- Clearly distinguish verified facts, uncertainty, estimates, and interpretation.\n- Do not invent sources, citations, quotes, dates, or claims that were not supported by the research.\n- Keep citations attached to the claims they support. The user interface will make cited URLs visible and clickable.\n`;\n\napp.disable("x-powered-by");'''
server = replace_once(server, work_tail, research_tail, "research prompt")

server = replace_once(
    server,
    '      total_tokens INTEGER NOT NULL DEFAULT 0,\n      estimated_cost_micros BIGINT,',
    '      total_tokens INTEGER NOT NULL DEFAULT 0,\n      web_search_calls INTEGER NOT NULL DEFAULT 0,\n      estimated_cost_micros BIGINT,',
    "usage table web search column",
)
server = replace_once(
    server,
    '    CREATE INDEX IF NOT EXISTS usage_events_created_at_idx',
    '    ALTER TABLE usage_events\n      ADD COLUMN IF NOT EXISTS web_search_calls INTEGER NOT NULL DEFAULT 0;\n\n    CREATE INDEX IF NOT EXISTS usage_events_created_at_idx',
    "usage migration",
)

server = replace_once(
    server,
    '  usage = null,\n  estimatedCostMicros = null,',
    '  usage = null,\n  webSearchCalls = 0,\n  estimatedCostMicros = null,',
    "usage function signature",
)
server = replace_once(
    server,
    '  if (!databaseReady || !pool || !usage) {\n    return;\n  }',
    '  if (!databaseReady || !pool || (!usage && !webSearchCalls)) {\n    return;\n  }',
    "usage function guard",
)
server = replace_once(
    server,
    '       total_tokens,\n       estimated_cost_micros,',
    '       total_tokens,\n       web_search_calls,\n       estimated_cost_micros,',
    "usage insert columns",
)
server = replace_once(
    server,
    '     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    '     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    "usage insert placeholders",
)
server = replace_once(
    server,
    '      totalTokens,\n      estimatedCostMicros,',
    '      totalTokens,\n      Math.max(0, Number(webSearchCalls || 0)),\n      estimatedCostMicros,',
    "usage insert values",
)

summary_old = '             COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,\n             COUNT(estimated_cost_micros)::bigint AS priced_events,'
summary_new = '             COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,\n             COALESCE(SUM(web_search_calls), 0)::bigint AS web_search_calls,\n             COUNT(estimated_cost_micros)::bigint AS priced_events,'
if server.count(summary_old) != 3:
    raise SystemExit(f"usage summary SQL: expected 3 matches, found {server.count(summary_old)}")
server = server.replace(summary_old, summary_new)

server = replace_once(
    server,
    '          totalTokens: Number(totals.total_tokens),\n          pricedEvents: Number(totals.priced_events),',
    '          totalTokens: Number(totals.total_tokens),\n          webSearchCalls: Number(totals.web_search_calls),\n          pricedEvents: Number(totals.priced_events),',
    "usage totals response",
)
row_old = '          totalTokens: Number(row.total_tokens),\n          pricedEvents: Number(row.priced_events),'
row_new = '          totalTokens: Number(row.total_tokens),\n          webSearchCalls: Number(row.web_search_calls),\n          pricedEvents: Number(row.priced_events),'
if server.count(row_old) != 2:
    raise SystemExit(f"usage row response: expected 2 matches, found {server.count(row_old)}")
server = server.replace(row_old, row_new)

normalize_depth = '''function normalizeDepthStyle(value) {\n  return String(value || "").trim().toLowerCase() === "work"\n    ? "work"\n    : "casual";\n}\n'''
normalize_both = normalize_depth + '''\nfunction normalizeProductMode(value) {\n  return String(value || "").trim().toLowerCase() === "research"\n    ? "research"\n    : "standard";\n}\n'''
server = replace_once(server, normalize_depth, normalize_both, "product mode normalizer")

server = replace_once(
    server,
    '''    const history = cleanHistory(req.body.history);\n    const depthStyle = normalizeDepthStyle(req.body.depthStyle);\n    const depthInstructions =\n      depthStyle === "work" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;''',
    '''    const history = cleanHistory(req.body.history);\n    const depthStyle = normalizeDepthStyle(req.body.depthStyle);\n    const productMode = normalizeProductMode(req.body.productMode);\n    const depthInstructions =\n      depthStyle === "work" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;\n    const modeInstructions =\n      productMode === "research" ? RESEARCH_MODE_PROMPT : "";''',
    "chat mode selection",
)

old_generate = '''    const aiResponse = await generateChat({\n      model: gatewayStatus.model,\n      instructions: UNBOUND_SYSTEM_PROMPT + "\\n\\n" + depthInstructions,\n      input\n    });'''
new_generate = '''    if (productMode === "research" && !gatewayStatus.research) {\n      return res.status(503).json({\n        error: "The active AI provider does not support Research Mode yet."\n      });\n    }\n\n    const aiResponse = await generateChat({\n      model: gatewayStatus.model,\n      instructions: [UNBOUND_SYSTEM_PROMPT, depthInstructions, modeInstructions]\n        .filter(Boolean)\n        .join("\\n\\n"),\n      input,\n      research:\n        productMode === "research"\n          ? { enabled: true, maxToolCalls: depthStyle === "work" ? 8 : 4 }\n          : null\n    });\n\n    const researchMetadata = aiResponse.research || {\n      sources: [],\n      citations: [],\n      webSearchCalls: 0\n    };'''
server = replace_once(server, old_generate, new_generate, "gateway research request")

server = replace_once(
    server,
    '          eventType: "chat_" + depthStyle,\n          usage: aiResponse.usage,',
    '          eventType: "chat_" + productMode + "_" + depthStyle,\n          usage: aiResponse.usage,\n          webSearchCalls: researchMetadata.webSearchCalls,',
    "research usage event",
)

old_json = '''    res.json({\n      reply: aiResponse.reply,\n      depthStyle,\n      provider: aiResponse.provider,\n      model: aiResponse.model\n    });'''
new_json = '''    res.json({\n      reply: aiResponse.reply,\n      depthStyle,\n      productMode,\n      provider: aiResponse.provider,\n      model: aiResponse.model,\n      sources: researchMetadata.sources,\n      citations: researchMetadata.citations,\n      webSearchCalls: researchMetadata.webSearchCalls\n    });'''
server = replace_once(server, old_json, new_json, "research response JSON")

server_path.write_text(server)

Path("app/ai/gateway.js").write_text(r'''const openai = require("./providers/openai");

const providers = new Map([[openai.id, openai]]);

function normalizeProviderName(value) {
  return String(value || "openai").trim().toLowerCase();
}

function getProvider() {
  const name = normalizeProviderName(process.env.AI_PROVIDER);
  const provider = providers.get(name);

  if (!provider) {
    const error = new Error(`Unsupported AI provider: ${name}`);
    error.code = "AI_PROVIDER_UNSUPPORTED";
    throw error;
  }

  return provider;
}

function providerSupportsResearch(provider) {
  return typeof provider?.supportsResearch === "function" && provider.supportsResearch();
}

function getGatewayStatus() {
  const name = normalizeProviderName(process.env.AI_PROVIDER);
  const provider = providers.get(name);

  if (!provider) {
    return {
      provider: name,
      configured: false,
      model: null,
      streaming: false,
      research: false,
      error: "unsupported-provider"
    };
  }

  return {
    provider: provider.id,
    configured: provider.isConfigured(),
    model: provider.getModel(),
    streaming: typeof provider.streamChat === "function",
    research: providerSupportsResearch(provider),
    error: provider.isConfigured() ? null : "provider-not-configured"
  };
}

async function generateChat({ instructions, input, model, research = null }) {
  const provider = getProvider();

  if (research?.enabled && !providerSupportsResearch(provider)) {
    const error = new Error(`AI provider '${provider.id}' does not support Research Mode.`);
    error.code = "AI_PROVIDER_RESEARCH_UNSUPPORTED";
    throw error;
  }

  return provider.generateChat({ instructions, input, model, research });
}

async function streamChat({ instructions, input, model, onDelta }) {
  const provider = getProvider();

  if (typeof provider.streamChat !== "function") {
    const result = await provider.generateChat({ instructions, input, model });
    if (onDelta && result.reply) {
      await onDelta(result.reply);
    }
    return result;
  }

  return provider.streamChat({ instructions, input, model, onDelta });
}

module.exports = {
  generateChat,
  streamChat,
  getGatewayStatus,
  normalizeProviderName
};
''')

Path("app/ai/providers/openai.js").write_text(r'''const DEFAULT_MODEL = "gpt-5.6-luna";

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
''')

print("Research Mode integrated with provider-neutral gateway.")
