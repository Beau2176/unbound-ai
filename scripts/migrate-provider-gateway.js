const fs = require("fs");
const path = require("path");

const serverPath = path.join(__dirname, "..", "app", "server.js");
let source = fs.readFileSync(serverPath, "utf8");

function replaceOnce(oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  }
  source = source.replace(oldText, newText);
}

function replaceRegexOnce(regex, newText, label) {
  const matches = source.match(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g"));
  const count = matches ? matches.length : 0;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  }
  source = source.replace(regex, newText);
}

replaceOnce(
  'const { Pool } = require("pg");\n',
  'const { Pool } = require("pg");\nconst { generateChat, getGatewayStatus } = require("./ai/gateway");\n',
  "gateway require"
);

replaceRegexOnce(
  /function estimateOpenAICostMicros\(usage\) \{[\s\S]*?\n\}\n\nasync function recordUsageEvent/,
  [
    'function estimateProviderCostMicros(provider, usage) {',
    '  const prefix = String(provider || "")',
    '    .trim()',
    '    .toUpperCase()',
    '    .replace(/[^A-Z0-9]/g, "_");',
    '',
    '  if (!prefix) {',
    '    return null;',
    '  }',
    '',
    '  const inputRate = numberFromEnv(prefix + "_INPUT_USD_PER_MILLION");',
    '  const outputRate = numberFromEnv(prefix + "_OUTPUT_USD_PER_MILLION");',
    '',
    '  if (inputRate === null || outputRate === null) {',
    '    return null;',
    '  }',
    '',
    '  const inputTokens = Number(usage?.input_tokens || 0);',
    '  const outputTokens = Number(usage?.output_tokens || 0);',
    '',
    '  // USD-per-million-token pricing converts directly to microdollars per token.',
    '  return Math.max(',
    '    0,',
    '    Math.round(inputTokens * inputRate + outputTokens * outputRate)',
    '  );',
    '}',
    '',
    'async function recordUsageEvent'
  ].join("\n"),
  "provider cost estimator"
);

replaceOnce(
  'app.get("/api/health", (req, res) => {\n  res.json({\n    ok: true,\n    database: databaseReady ? "connected" : "not-connected",\n    accounts: databaseReady ? "ready" : "not-ready"\n  });\n});',
  'app.get("/api/health", (req, res) => {\n  res.json({\n    ok: true,\n    database: databaseReady ? "connected" : "not-connected",\n    accounts: databaseReady ? "ready" : "not-ready",\n    ai: getGatewayStatus()\n  });\n});',
  "health gateway status"
);

replaceRegexOnce(
  /    if \(!process\.env\.OPENAI_API_KEY\) \{[\s\S]*?    const client = new OpenAI\(\{[\s\S]*?    \}\);\n\n/,
  [
    '    const gatewayStatus = getGatewayStatus();',
    '',
    '    if (!gatewayStatus.configured) {',
    '      return res.status(503).json({',
    '        error:',
    '          gatewayStatus.error === "unsupported-provider"',
    '            ? "AI provider \'" + gatewayStatus.provider + "\' is not supported."',
    '            : "AI provider \'" + gatewayStatus.provider + "\' is not configured."',
    '      });',
    '    }',
    ''
  ].join("\n"),
  "remove direct OpenAI client"
);

replaceRegexOnce(
  /    const model = "gpt-5\.6-luna";[\s\S]*?    res\.json\(\{\n      reply: response\.output_text,\n      depthStyle\n    \}\);/,
  [
    '    const aiResponse = await generateChat({',
    '      model: gatewayStatus.model,',
    '      instructions: UNBOUND_SYSTEM_PROMPT + "\\n\\n" + depthInstructions,',
    '      input',
    '    });',
    '',
    '    if (databaseReady && pool && aiResponse.usage) {',
    '      try {',
    '        const sessionUser = await findSessionUser(req);',
    '',
    '        await recordUsageEvent({',
    '          userId: sessionUser?.id || null,',
    '          provider: aiResponse.provider,',
    '          model: aiResponse.model,',
    '          eventType: "chat_" + depthStyle,',
    '          usage: aiResponse.usage,',
    '          estimatedCostMicros: estimateProviderCostMicros(',
    '            aiResponse.provider,',
    '            aiResponse.usage',
    '          ),',
    '          providerResponseId: aiResponse.responseId',
    '        });',
    '      } catch (usageError) {',
    '        console.error("UNBOUND AI USAGE METER ERROR:", usageError);',
    '      }',
    '    }',
    '',
    '    res.json({',
    '      reply: aiResponse.reply,',
    '      depthStyle,',
    '      provider: aiResponse.provider,',
    '      model: aiResponse.model',
    '    });'
  ].join("\n"),
  "chat gateway invocation"
);

fs.writeFileSync(serverPath, source);
console.log("Provider-neutral gateway migration applied.");
