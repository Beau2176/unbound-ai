from pathlib import Path
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def regex_replace_once(text, pattern, replacement, label, flags=re.S):
    text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text


# ---------------------------------------------------------------------
# SERVER: Research Mode + persistent Research metadata + usage metering
# ---------------------------------------------------------------------
server_path = Path("app/server.js")
server = server_path.read_text()

server = replace_once(
    server,
    '- This server does not yet provide external web/research tools to the model. Never claim external research, browsing, source verification, or tool use unless those capabilities are actually added and invoked.',
    '- Use external research only when research tools are actually provided for the current request. Never claim browsing, verification, or tool use unless it actually occurred.',
    "work prompt research capability",
)

server = replace_once(
    server,
    '''- Use external research only when research tools are actually provided for the current request. Never claim browsing, verification, or tool use unless it actually occurred.\n`;\n\napp.disable("x-powered-by");''',
    '''- Use external research only when research tools are actually provided for the current request. Never claim browsing, verification, or tool use unless it actually occurred.\n`;\n\nconst RESEARCH_MODE_PROMPT = `\nProduct mode: RESEARCH MODE.\n- Use the provided web-search capability before answering.\n- Prefer primary, official, recent, and directly relevant sources when they are available.\n- Cross-check important or disputed claims across more than one source when practical.\n- Clearly distinguish verified facts, uncertainty, estimates, and interpretation.\n- Do not invent sources, citations, quotes, dates, or claims that were not supported by the research.\n- Keep citations attached to the claims they support. The user interface will make cited URLs visible and clickable.\n`;\n\napp.disable("x-powered-by");''',
    "research prompt insertion",
)

server = replace_once(
    server,
    '''      title TEXT NOT NULL DEFAULT 'New chat',\n      depth_style TEXT NOT NULL DEFAULT 'casual',\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),''',
    '''      title TEXT NOT NULL DEFAULT 'New chat',\n      depth_style TEXT NOT NULL DEFAULT 'casual',\n      product_mode TEXT NOT NULL DEFAULT 'standard',\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),''',
    "conversation product mode schema",
)

server = replace_once(
    server,
    '''    CREATE INDEX IF NOT EXISTS conversations_user_updated_idx\n      ON conversations(user_id, updated_at DESC, id DESC);''',
    '''    ALTER TABLE conversations\n      ADD COLUMN IF NOT EXISTS product_mode TEXT NOT NULL DEFAULT 'standard';\n\n    CREATE INDEX IF NOT EXISTS conversations_user_updated_idx\n      ON conversations(user_id, updated_at DESC, id DESC);''',
    "conversation product mode migration",
)

server = replace_once(
    server,
    '''      role TEXT NOT NULL,\n      content TEXT NOT NULL,\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),''',
    '''      role TEXT NOT NULL,\n      content TEXT NOT NULL,\n      research_sources JSONB NOT NULL DEFAULT '[]'::jsonb,\n      research_citations JSONB NOT NULL DEFAULT '[]'::jsonb,\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),''',
    "conversation research metadata schema",
)

server = replace_once(
    server,
    '''    CREATE INDEX IF NOT EXISTS conversation_messages_conversation_id_idx\n      ON conversation_messages(conversation_id, id);''',
    '''    ALTER TABLE conversation_messages\n      ADD COLUMN IF NOT EXISTS research_sources JSONB NOT NULL DEFAULT '[]'::jsonb;\n\n    ALTER TABLE conversation_messages\n      ADD COLUMN IF NOT EXISTS research_citations JSONB NOT NULL DEFAULT '[]'::jsonb;\n\n    CREATE INDEX IF NOT EXISTS conversation_messages_conversation_id_idx\n      ON conversation_messages(conversation_id, id);''',
    "conversation research metadata migration",
)

server = replace_once(
    server,
    '''      total_tokens INTEGER NOT NULL DEFAULT 0,\n      estimated_cost_micros BIGINT,''',
    '''      total_tokens INTEGER NOT NULL DEFAULT 0,\n      web_search_calls INTEGER NOT NULL DEFAULT 0,\n      estimated_cost_micros BIGINT,''',
    "usage web search schema",
)

server = replace_once(
    server,
    '''    CREATE INDEX IF NOT EXISTS usage_events_created_at_idx\n      ON usage_events(created_at DESC);''',
    '''    ALTER TABLE usage_events\n      ADD COLUMN IF NOT EXISTS web_search_calls INTEGER NOT NULL DEFAULT 0;\n\n    CREATE INDEX IF NOT EXISTS usage_events_created_at_idx\n      ON usage_events(created_at DESC);''',
    "usage web search migration",
)

record_usage = r'''async function recordUsageEvent({
  userId = null,
  provider,
  model,
  eventType = "chat",
  usage = null,
  webSearchCalls = 0,
  estimatedCostMicros = null,
  providerResponseId = null
}) {
  if (!databaseReady || !pool || (!usage && !webSearchCalls)) {
    return;
  }

  const inputTokens = Math.max(0, Number(usage?.input_tokens || 0));
  const outputTokens = Math.max(0, Number(usage?.output_tokens || 0));
  const totalTokens = Math.max(
    0,
    Number(usage?.total_tokens || inputTokens + outputTokens)
  );

  await pool.query(
    `INSERT INTO usage_events (
       user_id,
       provider,
       model,
       event_type,
       input_tokens,
       output_tokens,
       total_tokens,
       web_search_calls,
       estimated_cost_micros,
       provider_response_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      userId,
      provider,
      model,
      eventType,
      inputTokens,
      outputTokens,
      totalTokens,
      Math.max(0, Number(webSearchCalls || 0)),
      estimatedCostMicros,
      providerResponseId
    ]
  );
}
'''
server = regex_replace_once(
    server,
    r'async function recordUsageEvent\(\{[\s\S]*?\n\}\n\nasync function requireSignedIn',
    record_usage + '\nasync function requireSignedIn',
    "recordUsageEvent replacement",
)

history_section = r'''/* ------------------------- CONVERSATION HISTORY ------------------------ */

function conversationTitleFromMessage(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || "New chat").slice(0, 72);
}

function validConversationId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function normalizeResearchSources(value) {
  if (!Array.isArray(value)) return [];

  const results = [];
  const seen = new Set();

  for (const item of value) {
    if (results.length >= 12) break;

    try {
      const parsed = new URL(String(item?.url || ""));
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      const url = parsed.toString().slice(0, 2048);
      if (seen.has(url)) continue;
      seen.add(url);

      const number = Number(item?.number);
      results.push({
        number: Number.isInteger(number) && number > 0 ? number : results.length + 1,
        title: String(item?.title || "Source").trim().slice(0, 220) || "Source",
        url
      });
    } catch {
      continue;
    }
  }

  return results;
}

function normalizeResearchCitations(value, sources, contentLength = 12000) {
  if (!Array.isArray(value)) return [];
  const allowedNumbers = new Set(sources.map((source) => Number(source.number)));

  return value
    .map((item) => ({
      sourceNumber: Number(item?.sourceNumber),
      startIndex: Number(item?.startIndex),
      endIndex: Number(item?.endIndex)
    }))
    .filter((item) =>
      allowedNumbers.has(item.sourceNumber) &&
      Number.isInteger(item.startIndex) &&
      Number.isInteger(item.endIndex) &&
      item.startIndex >= 0 &&
      item.endIndex >= item.startIndex &&
      item.endIndex <= contentLength
    )
    .slice(0, 30);
}

function cleanStoredMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((item) =>
      item &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string" &&
      item.content.trim()
    )
    .map((item) => {
      const content = item.content.trim().slice(0, 12000);
      const sources = item.role === "assistant"
        ? normalizeResearchSources(item.sources)
        : [];
      const citations = item.role === "assistant"
        ? normalizeResearchCitations(item.citations, sources, content.length)
        : [];

      return {
        role: item.role,
        content,
        sources,
        citations
      };
    })
    .slice(-50);
}

function publicConversation(row) {
  return {
    id: String(row.id),
    title: row.title || "New chat",
    depthStyle: normalizeDepthStyle(row.depth_style),
    productMode: normalizeProductMode(row.product_mode),
    messageCount: Number(row.message_count || 0),
    preview: row.preview || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getConversationMessages(conversationId, limit = 200, client = pool) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const result = await client.query(
    `SELECT id, role, content, research_sources, research_citations, created_at
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY id DESC
     LIMIT $2`,
    [conversationId, safeLimit]
  );

  return result.rows.reverse().map((row) => {
    const content = String(row.content || "");
    const sources = row.role === "assistant"
      ? normalizeResearchSources(row.research_sources)
      : [];
    const citations = row.role === "assistant"
      ? normalizeResearchCitations(row.research_citations, sources, content.length)
      : [];

    return {
      id: String(row.id),
      role: row.role,
      content,
      sources,
      citations,
      createdAt: row.created_at
    };
  });
}

async function preparePersistentChat(req, message, depthStyle, productMode) {
  if (!databaseReady || !pool) {
    return null;
  }

  const user = await findSessionUser(req);
  if (!user) {
    return null;
  }

  const requestedId = String(req.body.conversationId || "").trim();
  if (requestedId && !validConversationId(requestedId)) {
    const error = new Error("Invalid conversation ID.");
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    let conversation;

    if (requestedId) {
      const result = await client.query(
        `SELECT id, user_id, title, depth_style, product_mode, created_at, updated_at
         FROM conversations
         WHERE id = $1 AND user_id = $2
         LIMIT 1
         FOR UPDATE`,
        [requestedId, user.id]
      );
      conversation = result.rows[0];

      if (!conversation) {
        const error = new Error("Conversation not found.");
        error.statusCode = 404;
        throw error;
      }
    } else {
      const result = await client.query(
        `INSERT INTO conversations (user_id, title, depth_style, product_mode)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, title, depth_style, product_mode, created_at, updated_at`,
        [user.id, conversationTitleFromMessage(message), depthStyle, productMode]
      );
      conversation = result.rows[0];
    }

    const priorResult = await client.query(
      `SELECT role, content
       FROM conversation_messages
       WHERE conversation_id = $1
       ORDER BY id DESC
       LIMIT 20`,
      [conversation.id]
    );
    const history = priorResult.rows.reverse().map((row) => ({
      role: row.role,
      content: row.content
    }));

    await client.query(
      `INSERT INTO conversation_messages (conversation_id, role, content)
       VALUES ($1, 'user', $2)`,
      [conversation.id, message.slice(0, 12000)]
    );

    const nextTitle =
      !conversation.title || conversation.title === "New chat"
        ? conversationTitleFromMessage(message)
        : conversation.title;

    await client.query(
      `UPDATE conversations
       SET title = $1,
           depth_style = $2,
           product_mode = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [nextTitle, depthStyle, productMode, conversation.id]
    );

    await client.query("COMMIT");

    return {
      user,
      conversationId: String(conversation.id),
      history
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function persistAssistantMessage(
  persistentChat,
  content,
  depthStyle,
  productMode,
  researchMetadata = {}
) {
  if (!persistentChat || !databaseReady || !pool) {
    return;
  }

  const text = String(content || "").trim().slice(0, 12000);
  if (!text) {
    return;
  }

  const sources = normalizeResearchSources(researchMetadata.sources);
  const citations = normalizeResearchCitations(
    researchMetadata.citations,
    sources,
    text.length
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO conversation_messages (
         conversation_id,
         role,
         content,
         research_sources,
         research_citations
       )
       VALUES ($1, 'assistant', $2, $3::jsonb, $4::jsonb)`,
      [
        persistentChat.conversationId,
        text,
        JSON.stringify(sources),
        JSON.stringify(citations)
      ]
    );
    await client.query(
      `UPDATE conversations
       SET depth_style = $1,
           product_mode = $2,
           updated_at = NOW()
       WHERE id = $3 AND user_id = $4`,
      [
        depthStyle,
        productMode,
        persistentChat.conversationId,
        persistentChat.user.id
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

app.get(
  "/api/conversations",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const requestedLimit = Number.parseInt(String(req.query.limit || "50"), 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 100)
        : 50;

      const result = await pool.query(
        `SELECT
           c.id,
           c.title,
           c.depth_style,
           c.product_mode,
           c.created_at,
           c.updated_at,
           COUNT(m.id)::bigint AS message_count,
           COALESCE((
             SELECT cm.content
             FROM conversation_messages cm
             WHERE cm.conversation_id = c.id
             ORDER BY cm.id DESC
             LIMIT 1
           ), '') AS preview
         FROM conversations c
         LEFT JOIN conversation_messages m ON m.conversation_id = c.id
         WHERE c.user_id = $1
         GROUP BY c.id
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT $2`,
        [req.user.id, limit]
      );

      return res.json({
        conversations: result.rows.map(publicConversation)
      });
    } catch (error) {
      console.error("UNBOUND AI CONVERSATION LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load conversation history." });
    }
  }
);

app.get(
  "/api/conversations/:id",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const conversationId = String(req.params.id || "").trim();
      if (!validConversationId(conversationId)) {
        return res.status(400).json({ error: "Invalid conversation ID." });
      }

      const result = await pool.query(
        `SELECT id, title, depth_style, product_mode, created_at, updated_at
         FROM conversations
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [conversationId, req.user.id]
      );
      const conversation = result.rows[0];

      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found." });
      }

      const messages = await getConversationMessages(conversation.id, 500);
      return res.json({
        conversation: publicConversation({
          ...conversation,
          message_count: messages.length,
          preview: messages[messages.length - 1]?.content || ""
        }),
        messages
      });
    } catch (error) {
      console.error("UNBOUND AI CONVERSATION LOAD ERROR:", error);
      return res.status(500).json({ error: "Could not load that conversation." });
    }
  }
);

app.post(
  "/api/conversations",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const depthStyle = normalizeDepthStyle(req.body.depthStyle);
      const productMode = normalizeProductMode(req.body.productMode);
      const result = await pool.query(
        `INSERT INTO conversations (user_id, title, depth_style, product_mode)
         VALUES ($1, 'New chat', $2, $3)
         RETURNING id, title, depth_style, product_mode, created_at, updated_at`,
        [req.user.id, depthStyle, productMode]
      );
      return res.status(201).json({
        conversation: publicConversation({
          ...result.rows[0],
          message_count: 0,
          preview: ""
        })
      });
    } catch (error) {
      console.error("UNBOUND AI CONVERSATION CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not start a new conversation." });
    }
  }
);

app.post(
  "/api/conversations/import",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    const messages = cleanStoredMessages(req.body.messages).slice(-50);
    if (!messages.length) {
      return res.status(400).json({ error: "There is no conversation to import." });
    }

    const depthStyle = normalizeDepthStyle(req.body.depthStyle);
    const productMode = normalizeProductMode(req.body.productMode);
    const firstUser = messages.find((item) => item.role === "user");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const created = await client.query(
        `INSERT INTO conversations (user_id, title, depth_style, product_mode)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, depth_style, product_mode, created_at, updated_at`,
        [
          req.user.id,
          conversationTitleFromMessage(firstUser?.content || "Imported chat"),
          depthStyle,
          productMode
        ]
      );
      const conversation = created.rows[0];

      for (const item of messages) {
        await client.query(
          `INSERT INTO conversation_messages (
             conversation_id,
             role,
             content,
             research_sources,
             research_citations
           )
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
          [
            conversation.id,
            item.role,
            item.content,
            JSON.stringify(item.sources || []),
            JSON.stringify(item.citations || [])
          ]
        );
      }

      await client.query(
        `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
        [conversation.id]
      );
      await client.query("COMMIT");

      return res.status(201).json({
        conversation: publicConversation({
          ...conversation,
          message_count: messages.length,
          preview: messages[messages.length - 1]?.content || ""
        }),
        messages
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("UNBOUND AI CONVERSATION IMPORT ERROR:", error);
      return res.status(500).json({ error: "Could not import the existing conversation." });
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/conversations/:id",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const conversationId = String(req.params.id || "").trim();
      if (!validConversationId(conversationId)) {
        return res.status(400).json({ error: "Invalid conversation ID." });
      }

      const result = await pool.query(
        `DELETE FROM conversations
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [conversationId, req.user.id]
      );

      if (!result.rows[0]) {
        return res.status(404).json({ error: "Conversation not found." });
      }

      return res.json({ ok: true, id: conversationId });
    } catch (error) {
      console.error("UNBOUND AI CONVERSATION DELETE ERROR:", error);
      return res.status(500).json({ error: "Could not delete that conversation." });
    }
  }
);
'''
server = regex_replace_once(
    server,
    r'/\* ------------------------- CONVERSATION HISTORY ------------------------ \*/[\s\S]*?(?=/\* ----------------------------- ADMIN API ----------------------------- \*/)',
    history_section + '\n',
    "conversation history section replacement",
)

# Usage summary: count web search calls in totals, model rows, and daily rows.
summary_token = '             COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,\n             COUNT(estimated_cost_micros)::bigint AS priced_events,'
if server.count(summary_token) != 3:
    raise SystemExit(f"usage summary SQL: expected 3 matches, found {server.count(summary_token)}")
server = server.replace(
    summary_token,
    '             COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,\n             COALESCE(SUM(web_search_calls), 0)::bigint AS web_search_calls,\n             COUNT(estimated_cost_micros)::bigint AS priced_events,'
)
server = replace_once(
    server,
    '          totalTokens: Number(totals.total_tokens),\n          pricedEvents: Number(totals.priced_events),',
    '          totalTokens: Number(totals.total_tokens),\n          webSearchCalls: Number(totals.web_search_calls),\n          pricedEvents: Number(totals.priced_events),',
    "usage totals JSON",
)
row_token = '          totalTokens: Number(row.total_tokens),\n          pricedEvents: Number(row.priced_events),'
if server.count(row_token) != 2:
    raise SystemExit(f"usage summary row JSON: expected 2 matches, found {server.count(row_token)}")
server = server.replace(
    row_token,
    '          totalTokens: Number(row.total_tokens),\n          webSearchCalls: Number(row.web_search_calls),\n          pricedEvents: Number(row.priced_events),'
)

chat_section = r'''/* ----------------------------- CHAT API ------------------------------ */

function normalizeDepthStyle(value) {
  return String(value || "").trim().toLowerCase() === "work"
    ? "work"
    : "casual";
}

function normalizeProductMode(value) {
  return String(value || "").trim().toLowerCase() === "research"
    ? "research"
    : "standard";
}

function cleanHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => {
      return (
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim()
      );
    })
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 12000)
    }))
    .slice(-50);
}

app.post("/api/chat", async (req, res) => {
  try {
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!message) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    const gatewayStatus = getGatewayStatus();

    if (!gatewayStatus.configured) {
      return res.status(503).json({
        error:
          gatewayStatus.error === "unsupported-provider"
            ? "AI provider '" + gatewayStatus.provider + "' is not supported."
            : "AI provider '" + gatewayStatus.provider + "' is not configured."
      });
    }

    const depthStyle = normalizeDepthStyle(req.body.depthStyle);
    const productMode = normalizeProductMode(req.body.productMode);

    if (productMode === "research" && !gatewayStatus.research) {
      return res.status(503).json({
        error: "The active AI provider does not support Research Mode yet."
      });
    }

    const persistentChat = await preparePersistentChat(
      req,
      message,
      depthStyle,
      productMode
    );
    const history = persistentChat
      ? persistentChat.history
      : cleanHistory(req.body.history).slice(-20);
    const depthInstructions =
      depthStyle === "work" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;
    const modeInstructions =
      productMode === "research" ? RESEARCH_MODE_PROMPT : "";

    const input = [
      ...history,
      {
        role: "user",
        content: message.slice(0, 12000)
      }
    ];

    const aiResponse = await generateChat({
      model: gatewayStatus.model,
      instructions: [UNBOUND_SYSTEM_PROMPT, depthInstructions, modeInstructions]
        .filter(Boolean)
        .join("\n\n"),
      input,
      research:
        productMode === "research"
          ? { enabled: true, maxToolCalls: depthStyle === "work" ? 8 : 4 }
          : null
    });

    const researchMetadata = aiResponse.research || {
      sources: [],
      citations: [],
      webSearchCalls: 0
    };

    if (persistentChat) {
      await persistAssistantMessage(
        persistentChat,
        aiResponse.reply,
        depthStyle,
        productMode,
        researchMetadata
      );
    }

    if (
      databaseReady &&
      pool &&
      (aiResponse.usage || researchMetadata.webSearchCalls)
    ) {
      try {
        const sessionUser = persistentChat?.user || await findSessionUser(req);

        await recordUsageEvent({
          userId: sessionUser?.id || null,
          provider: aiResponse.provider,
          model: aiResponse.model,
          eventType: "chat_" + productMode + "_" + depthStyle,
          usage: aiResponse.usage,
          webSearchCalls: researchMetadata.webSearchCalls,
          estimatedCostMicros: estimateProviderCostMicros(
            aiResponse.provider,
            aiResponse.usage
          ),
          providerResponseId: aiResponse.responseId
        });
      } catch (usageError) {
        console.error("UNBOUND AI USAGE METER ERROR:", usageError);
      }
    }

    res.json({
      reply: aiResponse.reply,
      depthStyle,
      productMode,
      provider: aiResponse.provider,
      model: aiResponse.model,
      sources: researchMetadata.sources,
      citations: researchMetadata.citations,
      webSearchCalls: researchMetadata.webSearchCalls,
      conversationId: persistentChat?.conversationId || null
    });
  } catch (error) {
    console.error("UNBOUND AI ERROR:", error);

    res.status(error.statusCode || 500).json({
      error: error.message || "UNBOUND AI could not get a response."
    });
  }
});

app.post("/api/chat/stream", async (req, res) => {
  try {
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : "";

    if (!message) {
      return res.status(400).json({ error: "Please enter a message." });
    }

    const gatewayStatus = getGatewayStatus();

    if (!gatewayStatus.configured) {
      return res.status(503).json({
        error:
          gatewayStatus.error === "unsupported-provider"
            ? "AI provider '" + gatewayStatus.provider + "' is not supported."
            : "AI provider '" + gatewayStatus.provider + "' is not configured."
      });
    }

    const depthStyle = normalizeDepthStyle(req.body.depthStyle);
    const productMode = normalizeProductMode(req.body.productMode);

    if (productMode === "research") {
      return res.status(400).json({
        error: "Research Mode uses the sourced response endpoint instead of streaming."
      });
    }

    const persistentChat = await preparePersistentChat(
      req,
      message,
      depthStyle,
      "standard"
    );
    const history = persistentChat
      ? persistentChat.history
      : cleanHistory(req.body.history).slice(-20);
    const depthInstructions =
      depthStyle === "work" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;
    const input = [
      ...history,
      { role: "user", content: message.slice(0, 12000) }
    ];

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const writeEvent = (event) => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(JSON.stringify(event) + "\n");
      }
    };

    writeEvent({
      type: "meta",
      depthStyle,
      productMode: "standard",
      provider: gatewayStatus.provider,
      model: gatewayStatus.model,
      conversationId: persistentChat?.conversationId || null
    });

    const aiResponse = await streamChat({
      model: gatewayStatus.model,
      instructions: UNBOUND_SYSTEM_PROMPT + "\n\n" + depthInstructions,
      input,
      onDelta: async (delta) => {
        writeEvent({ type: "delta", delta });
      }
    });

    if (persistentChat) {
      await persistAssistantMessage(
        persistentChat,
        aiResponse.reply,
        depthStyle,
        "standard",
        { sources: [], citations: [], webSearchCalls: 0 }
      );
    }

    if (databaseReady && pool && aiResponse.usage) {
      try {
        const sessionUser = persistentChat?.user || await findSessionUser(req);
        await recordUsageEvent({
          userId: sessionUser?.id || null,
          provider: aiResponse.provider,
          model: aiResponse.model,
          eventType: "chat_stream_standard_" + depthStyle,
          usage: aiResponse.usage,
          webSearchCalls: 0,
          estimatedCostMicros: estimateProviderCostMicros(
            aiResponse.provider,
            aiResponse.usage
          ),
          providerResponseId: aiResponse.responseId
        });
      } catch (usageError) {
        console.error("UNBOUND AI STREAM USAGE METER ERROR:", usageError);
      }
    }

    writeEvent({
      type: "done",
      depthStyle,
      productMode: "standard",
      provider: aiResponse.provider,
      model: aiResponse.model,
      conversationId: persistentChat?.conversationId || null
    });
    res.end();
  } catch (error) {
    console.error("UNBOUND AI STREAM ERROR:", error);

    if (res.headersSent) {
      if (!res.writableEnded && !res.destroyed) {
        res.write(
          JSON.stringify({
            type: "error",
            error: error.message || "UNBOUND AI could not get a response."
          }) + "\n"
        );
        res.end();
      }
      return;
    }

    res.status(error.statusCode || 500).json({
      error: error.message || "UNBOUND AI could not get a response."
    });
  }
});
'''
server = regex_replace_once(
    server,
    r'/\* ----------------------------- CHAT API ------------------------------ \*/[\s\S]*?(?=app\.get\("/",)',
    chat_section + '\n',
    "chat API section replacement",
)

server_path.write_text(server)


# ---------------------------------------------------------------------
# INDEX: Research selector, persistent citations, history integration
# ---------------------------------------------------------------------
index_path = Path("app/index.html")
index = index_path.read_text()

product_css = r'''
    .product-control {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border: 1px solid rgba(174, 128, 255, 0.30);
      border-radius: 10px;
      background: rgba(8, 5, 20, 0.72);
    }

    .product-button {
      padding: 6px 8px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #9f94b6;
      cursor: pointer;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.06em;
      transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
    }

    .product-button.active[data-product-mode="standard"] {
      background: rgba(107, 193, 255, 0.12);
      color: #d9efff;
      box-shadow: inset 0 0 0 1px rgba(107, 193, 255, 0.18);
    }

    .product-button.active[data-product-mode="research"] {
      background: rgba(162, 105, 255, 0.18);
      color: #e4d4ff;
      box-shadow: inset 0 0 0 1px rgba(188, 145, 255, 0.30);
    }
'''
index = replace_once(index, '    .new-chat {', product_css + '\n    .new-chat {', "product mode CSS")

source_css = r'''
    .inline-citation {
      display: inline-grid;
      place-items: center;
      min-width: 20px;
      height: 20px;
      margin-left: 3px;
      padding: 0 5px;
      border: 1px solid rgba(180, 132, 255, 0.45);
      border-radius: 999px;
      background: rgba(139, 82, 230, 0.18);
      color: #e7d8ff;
      text-decoration: none;
      font-size: 10px;
      font-weight: 900;
      vertical-align: 0.1em;
    }

    .inline-citation:hover {
      background: rgba(139, 82, 230, 0.30);
      border-color: rgba(200, 169, 255, 0.72);
    }

    .message-sources {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 11px;
      padding-top: 9px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .source-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 100%;
      padding: 5px 8px;
      border: 1px solid rgba(180, 132, 255, 0.30);
      border-radius: 999px;
      background: rgba(139, 82, 230, 0.10);
      color: #d9c6ff;
      text-decoration: none;
      font-size: 10px;
      line-height: 1.2;
    }

    .source-link:hover {
      background: rgba(139, 82, 230, 0.20);
      border-color: rgba(200, 169, 255, 0.55);
    }

    .source-link-number {
      font-weight: 900;
    }

    .source-link-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
'''
index = replace_once(index, '    .message.error {', source_css + '\n    .message.error {', "citation CSS")

index = replace_once(
    index,
    '''        <div class="chat-actions">\n          <div class="depth-control" role="group" aria-label="Response depth">''',
    '''        <div class="chat-actions">\n          <div class="product-control" role="group" aria-label="Product mode">\n            <button id="standardModeButton" class="product-button active" data-product-mode="standard" type="button" aria-pressed="true">STANDARD</button>\n            <button id="researchModeButton" class="product-button" data-product-mode="research" type="button" aria-pressed="false">RESEARCH</button>\n          </div>\n          <div class="depth-control" role="group" aria-label="Response depth">''',
    "product selector markup",
)
index = replace_once(
    index,
    '<div class="hint"><span id="depthStatus" class="depth-status">Casual Mode — Fast answers when you need them.</span> • Enter to send • Shift + Enter for a new line</div>',
    '<div class="hint"><span id="productStatus" class="depth-status">Standard Mode</span> • <span id="depthStatus" class="depth-status">Casual Mode — Fast answers when you need them.</span> • Enter to send • Shift + Enter for a new line</div>',
    "product status markup",
)

index = replace_once(
    index,
    '    const DEPTH_STYLE_KEY_BASE = "unbound-ai-depth-style-v1";\n',
    '    const DEPTH_STYLE_KEY_BASE = "unbound-ai-depth-style-v1";\n    const PRODUCT_MODE_KEY_BASE = "unbound-ai-product-mode-v1";\n',
    "product storage constant",
)
index = replace_once(
    index,
    '    const newChatButton = document.getElementById("newChatButton");\n',
    '    const newChatButton = document.getElementById("newChatButton");\n    const standardModeButton = document.getElementById("standardModeButton");\n    const researchModeButton = document.getElementById("researchModeButton");\n    const productStatus = document.getElementById("productStatus");\n',
    "product DOM references",
)
index = replace_once(
    index,
    '    let conversationHistory = [];\n    let depthStyle = "casual";\n',
    '    let conversationHistory = [];\n    let productMode = "standard";\n    let depthStyle = "casual";\n',
    "product mode state",
)

product_helpers = r'''    function productModeStorageKey() {
      if (currentUser && currentUser.id) {
        return `${PRODUCT_MODE_KEY_BASE}-user-${currentUser.id}`;
      }

      return `${PRODUCT_MODE_KEY_BASE}-guest`;
    }

    function normalizeProductMode(value) {
      return value === "research" ? "research" : "standard";
    }

    function loadProductMode() {
      try {
        return normalizeProductMode(localStorage.getItem(productModeStorageKey()));
      } catch (error) {
        console.warn("Could not load UNBOUND AI product mode:", error);
        return "standard";
      }
    }

    function saveProductMode() {
      try {
        localStorage.setItem(productModeStorageKey(), productMode);
      } catch (error) {
        console.warn("Could not save UNBOUND AI product mode:", error);
      }
    }

    function renderProductMode() {
      const isResearch = productMode === "research";
      standardModeButton.classList.toggle("active", !isResearch);
      researchModeButton.classList.toggle("active", isResearch);
      standardModeButton.setAttribute("aria-pressed", isResearch ? "false" : "true");
      researchModeButton.setAttribute("aria-pressed", isResearch ? "true" : "false");
      productStatus.textContent = isResearch
        ? "Research Mode — Live web search + citations"
        : "Standard Mode";
    }

    function setProductMode(value, { persist = true, announce = false } = {}) {
      productMode = normalizeProductMode(value);
      if (persist) saveProductMode();
      renderProductMode();
      if (announce) {
        showToast(
          productMode === "research"
            ? "Research Mode is active. Web search and citations will be used."
            : "Standard Mode is active."
        );
      }
    }

    function safeHttpUrl(value) {
      try {
        const url = new URL(String(value || ""));
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return null;
        }
        return url.toString();
      } catch {
        return null;
      }
    }

'''
index = replace_once(index, '    function normalizeDepthStyle(value) {', product_helpers + '    function normalizeDepthStyle(value) {', "product helpers")

normalize_history = r'''    function normalizeHistory(items) {
      if (!Array.isArray(items)) {
        return [];
      }

      return items
        .filter((item) => {
          return (
            item &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string" &&
            item.content.trim()
          );
        })
        .map((item) => {
          const content = item.content;
          const sources =
            item.role === "assistant" && Array.isArray(item.sources)
              ? item.sources
                  .map((source) => ({
                    number: Number(source?.number),
                    title: String(source?.title || "Source").slice(0, 220),
                    url: safeHttpUrl(source?.url)
                  }))
                  .filter(
                    (source) =>
                      Number.isInteger(source.number) &&
                      source.number > 0 &&
                      source.url
                  )
                  .slice(0, 12)
              : [];
          const sourceNumbers = new Set(sources.map((source) => source.number));
          const citations =
            item.role === "assistant" && Array.isArray(item.citations)
              ? item.citations
                  .map((citation) => ({
                    sourceNumber: Number(citation?.sourceNumber),
                    startIndex: Number(citation?.startIndex),
                    endIndex: Number(citation?.endIndex)
                  }))
                  .filter(
                    (citation) =>
                      sourceNumbers.has(citation.sourceNumber) &&
                      Number.isInteger(citation.startIndex) &&
                      Number.isInteger(citation.endIndex) &&
                      citation.startIndex >= 0 &&
                      citation.endIndex >= citation.startIndex &&
                      citation.endIndex <= content.length
                  )
                  .slice(0, 30)
              : [];

          return {
            role: item.role,
            content,
            sources,
            citations
          };
        })
        .slice(-MAX_STORED_MESSAGES);
    }
'''
index = regex_replace_once(
    index,
    r'    function normalizeHistory\(items\) \{[\s\S]*?\n    \}\n\n    function loadConversation',
    normalize_history + '\n    function loadConversation',
    "normalizeHistory replacement",
)

load_server = r'''    async function loadServerConversation(conversationId) {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || "Could not load that conversation.");
      }

      activeConversationId = String(data.conversation?.id || conversationId);
      conversationHistory = normalizeHistory(data.messages || []);
      productMode = normalizeProductMode(
        data.conversation?.productMode || loadProductMode()
      );
      depthStyle = normalizeDepthStyle(
        data.conversation?.depthStyle || loadDepthStyle()
      );
      saveProductMode();
      saveDepthStyle();
      renderProductMode();
      renderDepthStyle();
      renderConversation();
    }
'''
index = regex_replace_once(
    index,
    r'    async function loadServerConversation\(conversationId\) \{[\s\S]*?\n    \}\n\n    async function importLegacyConversationIfNeeded',
    load_server + '\n    async function importLegacyConversationIfNeeded',
    "loadServerConversation replacement",
)

index = replace_once(
    index,
    '        body: JSON.stringify({ messages: legacy, depthStyle: loadDepthStyle() })',
    '        body: JSON.stringify({\n          messages: legacy,\n          depthStyle: loadDepthStyle(),\n          productMode: loadProductMode()\n        })',
    "legacy import product mode",
)

switch_scope = r'''    async function switchConversationScope() {
      productMode = loadProductMode();
      depthStyle = loadDepthStyle();

      if (!currentUser) {
        activeConversationId = null;
        conversationHistory = loadConversation();
        renderProductMode();
        renderDepthStyle();
        renderConversation();
        return;
      }

      try {
        const conversations = await fetchServerConversationList(1);
        if (conversations.length) {
          await loadServerConversation(conversations[0].id);
          return;
        }

        const imported = await importLegacyConversationIfNeeded();
        if (imported) {
          renderProductMode();
          renderDepthStyle();
          renderConversation();
          showToast("Your existing chat was moved into your UNBOUND AI account.");
          return;
        }
      } catch (error) {
        console.warn("Could not load account conversation history:", error);
        showToast(error.message || "Could not load account conversation history.");
      }

      activeConversationId = null;
      conversationHistory = [];
      renderProductMode();
      renderDepthStyle();
      renderConversation();
    }
'''
index = regex_replace_once(
    index,
    r'    async function switchConversationScope\(\) \{[\s\S]*?\n    \}\n\n    function addMessage',
    switch_scope + '\n    function addMessage',
    "switchConversationScope replacement",
)

message_rendering = r'''    function renderAssistantHtml(content, sources = [], citations = []) {
      if (!Array.isArray(citations) || !citations.length) {
        return renderMarkdown(content);
      }

      const sourceMap = new Map(
        (sources || []).map((source) => [Number(source.number), source])
      );
      const valid = citations
        .filter((citation) => {
          const source = sourceMap.get(Number(citation.sourceNumber));
          return (
            source &&
            safeHttpUrl(source.url) &&
            Number.isInteger(citation.endIndex) &&
            citation.endIndex >= 0 &&
            citation.endIndex <= content.length
          );
        })
        .sort((a, b) => a.endIndex - b.endIndex);

      if (!valid.length) {
        return renderMarkdown(content);
      }

      let html = "";
      let cursor = 0;

      for (const citation of valid) {
        const end = Math.max(cursor, Math.min(content.length, citation.endIndex));
        html += renderMarkdown(content.slice(cursor, end));
        const source = sourceMap.get(Number(citation.sourceNumber));
        const url = safeHttpUrl(source.url);
        const title = escapeHtml(source.title || "Source");
        html += `<a class="inline-citation" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${title}">[${citation.sourceNumber}]</a>`;
        cursor = end;
      }

      html += renderMarkdown(content.slice(cursor));
      return html;
    }

    function appendSourceLinks(bubble, sources = []) {
      if (!Array.isArray(sources) || !sources.length) return;

      const list = document.createElement("div");
      list.className = "message-sources";

      for (const source of sources.slice(0, 12)) {
        const url = safeHttpUrl(source?.url);
        if (!url) continue;

        const link = document.createElement("a");
        link.className = "source-link";
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = source?.title || url;

        const number = document.createElement("span");
        number.className = "source-link-number";
        number.textContent = `[${Number(source?.number) || ""}]`;

        const title = document.createElement("span");
        title.className = "source-link-title";
        title.textContent = source?.title || url;

        link.append(number, title);
        list.appendChild(link);
      }

      if (list.childNodes.length) {
        bubble.appendChild(list);
      }
    }

    function addMessage(
      role,
      content,
      extraClass = "",
      sources = [],
      citations = []
    ) {
      const bubble = document.createElement("div");
      bubble.className = `message ${role} ${extraClass}`.trim();

      if (role === "assistant") {
        bubble.innerHTML = renderAssistantHtml(content, sources, citations);
        appendSourceLinks(bubble, sources);
      } else {
        bubble.textContent = content;
      }

      messages.appendChild(bubble);
      messages.scrollTop = messages.scrollHeight;
      return bubble;
    }
'''
index = regex_replace_once(
    index,
    r'    function addMessage\(role, content, extraClass = ""\) \{[\s\S]*?\n    \}\n\n    function showWelcomeMessage',
    message_rendering + '\n    function showWelcomeMessage',
    "message rendering replacement",
)

index = replace_once(
    index,
    '''      conversationHistory.forEach((item) => {\n        addMessage(item.role, item.content);\n      });''',
    '''      conversationHistory.forEach((item) => {\n        addMessage(\n          item.role,\n          item.content,\n          "",\n          item.sources || [],\n          item.citations || []\n        );\n      });''',
    "conversation citation rendering",
)

send_message = r'''    async function sendMessage() {
      const message = input.value.trim();

      if (!message) {
        return;
      }

      const priorHistory = conversationHistory.slice(-MAX_CONTEXT_MESSAGES);

      addMessage("user", message);
      conversationHistory.push({ role: "user", content: message });
      saveConversation();
      updateGoDeeperVisibility();

      input.value = "";
      input.focus();
      sendButton.disabled = true;
      goDeeperButton.disabled = true;
      const typingBubble = addTypingIndicator();
      let assistantBubble = null;
      let reply = "";

      try {
        if (productMode === "research") {
          const response = await fetch("/api/chat", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              message,
              history: priorHistory,
              depthStyle,
              productMode,
              conversationId: currentUser ? activeConversationId : null
            })
          });

          const data = await readJson(response);
          typingBubble.remove();

          if (!response.ok) {
            throw new Error(data.error || "Research request failed.");
          }

          if (data.conversationId) {
            activeConversationId = String(data.conversationId);
          }

          reply = data.reply || "No response returned.";
          const sources = Array.isArray(data.sources) ? data.sources : [];
          const citations = Array.isArray(data.citations) ? data.citations : [];
          assistantBubble = addMessage("assistant", reply, "", sources, citations);
          conversationHistory.push({
            role: "assistant",
            content: reply,
            sources,
            citations
          });
          saveConversation();
          updateGoDeeperVisibility();
          return;
        }

        const response = await fetch("/api/chat/stream", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/x-ndjson"
          },
          body: JSON.stringify({
            message,
            history: priorHistory,
            depthStyle,
            productMode: "standard",
            conversationId: currentUser ? activeConversationId : null
          })
        });

        if (!response.ok) {
          const data = await readJson(response);
          throw new Error(data.error || "Request failed.");
        }

        if (!response.body) {
          throw new Error("Streaming is not available in this browser.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleStreamLine = (line) => {
          if (!line.trim()) return;
          const event = JSON.parse(line);

          if ((event.type === "meta" || event.type === "done") && event.conversationId) {
            activeConversationId = String(event.conversationId);
          }

          if (event.type === "delta" && typeof event.delta === "string") {
            if (!assistantBubble) {
              typingBubble.remove();
              assistantBubble = addMessage("assistant", "");
            }
            reply += event.delta;
            assistantBubble.innerHTML = renderMarkdown(reply);
            messages.scrollTop = messages.scrollHeight;
          }

          if (event.type === "error") {
            throw new Error(event.error || "Streaming response failed.");
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            handleStreamLine(line);
          }

          if (done) break;
        }

        if (buffer.trim()) {
          handleStreamLine(buffer);
        }

        typingBubble.remove();

        if (!reply) {
          reply = "No response returned.";
          if (!assistantBubble) {
            assistantBubble = addMessage("assistant", reply);
          } else {
            assistantBubble.innerHTML = renderMarkdown(reply);
          }
        }

        conversationHistory.push({ role: "assistant", content: reply });
        saveConversation();
        updateGoDeeperVisibility();
      } catch (error) {
        typingBubble.remove();
        if (assistantBubble && reply && productMode !== "research") {
          assistantBubble.classList.add("error");
          assistantBubble.innerHTML = renderMarkdown(
            reply + "\n\n[Stream interrupted: " + (error.message || "unknown error") + "]"
          );
        } else {
          addMessage(
            "assistant",
            error.message || "UNBOUND AI could not get a response.",
            "error"
          );
        }
      } finally {
        sendButton.disabled = false;
        goDeeperButton.disabled = false;
        updateGoDeeperVisibility();
      }
    }
'''
index = regex_replace_once(
    index,
    r'    async function sendMessage\(\) \{[\s\S]*?(?=    async function goDeeper\(\) \{)',
    send_message + '\n',
    "sendMessage replacement",
)

index = replace_once(
    index,
    '''    historyCloseButton.addEventListener("click", closeHistory);\n    casualModeButton.addEventListener("click", () =>''',
    '''    historyCloseButton.addEventListener("click", closeHistory);\n    standardModeButton.addEventListener("click", () =>\n      setProductMode("standard", { announce: true })\n    );\n    researchModeButton.addEventListener("click", () =>\n      setProductMode("research", { announce: true })\n    );\n    casualModeButton.addEventListener("click", () =>''',
    "product mode event listeners",
)

index_path.write_text(index)

print("Applied Research Mode + persistent citation history integration.")
