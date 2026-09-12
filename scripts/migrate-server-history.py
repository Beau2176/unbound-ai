from pathlib import Path

server_path = Path("app/server.js")
index_path = Path("app/index.html")
server = server_path.read_text()
index = index_path.read_text()


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def replace_count(text, old, new, expected, label):
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{label}: expected {expected} matches, found {count}")
    return text.replace(old, new)


# ----------------------------- SERVER -----------------------------
conversation_schema = r'''    CREATE TABLE IF NOT EXISTS conversations (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New chat',
      depth_style TEXT NOT NULL DEFAULT 'casual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT conversations_depth_style_check CHECK (depth_style IN ('casual', 'work'))
    );

    CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
      ON conversations(user_id, updated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT conversation_messages_role_check CHECK (role IN ('user', 'assistant'))
    );

    CREATE INDEX IF NOT EXISTS conversation_messages_conversation_id_idx
      ON conversation_messages(conversation_id, id);

'''
server = replace_once(
    server,
    "    CREATE TABLE IF NOT EXISTS complimentary_top_tier_grants (\n",
    conversation_schema + "    CREATE TABLE IF NOT EXISTS complimentary_top_tier_grants (\n",
    "conversation schema",
)

signed_in_middleware = r'''async function requireSignedIn(req, res, next) {
  try {
    const user = await findSessionUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Sign in to access your UNBOUND AI conversation history."
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("UNBOUND AI USER AUTH ERROR:", error);
    return res.status(500).json({
      error: "Could not verify your account session."
    });
  }
}

'''
server = replace_once(
    server,
    "async function requireAdmin(req, res, next) {\n",
    signed_in_middleware + "async function requireAdmin(req, res, next) {\n",
    "signed-in middleware",
)

conversation_backend = r'''/* ------------------------- CONVERSATION HISTORY ------------------------ */

function conversationTitleFromMessage(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || "New chat").slice(0, 72);
}

function validConversationId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function publicConversation(row) {
  return {
    id: String(row.id),
    title: row.title || "New chat",
    depthStyle: normalizeDepthStyle(row.depth_style),
    messageCount: Number(row.message_count || 0),
    preview: row.preview || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getConversationMessages(conversationId, limit = 200, client = pool) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const result = await client.query(
    `SELECT id, role, content, created_at
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY id DESC
     LIMIT $2`,
    [conversationId, safeLimit]
  );

  return result.rows.reverse().map((row) => ({
    id: String(row.id),
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  }));
}

async function preparePersistentChat(req, message, depthStyle) {
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
        `SELECT id, user_id, title, depth_style, created_at, updated_at
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
        `INSERT INTO conversations (user_id, title, depth_style)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, title, depth_style, created_at, updated_at`,
        [user.id, conversationTitleFromMessage(message), depthStyle]
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
           updated_at = NOW()
       WHERE id = $3`,
      [nextTitle, depthStyle, conversation.id]
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

async function persistAssistantMessage(persistentChat, content, depthStyle) {
  if (!persistentChat || !databaseReady || !pool) {
    return;
  }

  const text = String(content || "").trim();
  if (!text) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO conversation_messages (conversation_id, role, content)
       VALUES ($1, 'assistant', $2)`,
      [persistentChat.conversationId, text.slice(0, 12000)]
    );
    await client.query(
      `UPDATE conversations
       SET depth_style = $1,
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3`,
      [depthStyle, persistentChat.conversationId, persistentChat.user.id]
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
        `SELECT id, title, depth_style, created_at, updated_at
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
      const result = await pool.query(
        `INSERT INTO conversations (user_id, title, depth_style)
         VALUES ($1, 'New chat', $2)
         RETURNING id, title, depth_style, created_at, updated_at`,
        [req.user.id, depthStyle]
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
    const messages = cleanHistory(req.body.messages).slice(-50);
    if (!messages.length) {
      return res.status(400).json({ error: "There is no conversation to import." });
    }

    const depthStyle = normalizeDepthStyle(req.body.depthStyle);
    const firstUser = messages.find((item) => item.role === "user");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const created = await client.query(
        `INSERT INTO conversations (user_id, title, depth_style)
         VALUES ($1, $2, $3)
         RETURNING id, title, depth_style, created_at, updated_at`,
        [
          req.user.id,
          conversationTitleFromMessage(firstUser?.content || "Imported chat"),
          depthStyle
        ]
      );
      const conversation = created.rows[0];

      for (const item of messages) {
        await client.query(
          `INSERT INTO conversation_messages (conversation_id, role, content)
           VALUES ($1, $2, $3)`,
          [conversation.id, item.role, item.content.slice(0, 12000)]
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
server = replace_once(
    server,
    "/* ----------------------------- ADMIN API ----------------------------- */\n",
    conversation_backend + "/* ----------------------------- ADMIN API ----------------------------- */\n",
    "conversation backend",
)

old_history = '''    const history = cleanHistory(req.body.history);\n    const depthStyle = normalizeDepthStyle(req.body.depthStyle);\n    const depthInstructions =\n'''
new_history = '''    const depthStyle = normalizeDepthStyle(req.body.depthStyle);\n    const persistentChat = await preparePersistentChat(req, message, depthStyle);\n    const history = persistentChat\n      ? persistentChat.history\n      : cleanHistory(req.body.history);\n    const depthInstructions =\n'''
server = replace_count(server, old_history, new_history, 2, "persistent chat context")

normal_ai = '''    const aiResponse = await generateChat({\n      model: gatewayStatus.model,\n      instructions: UNBOUND_SYSTEM_PROMPT + "\\n\\n" + depthInstructions,\n      input\n    });\n\n    if (databaseReady && pool && aiResponse.usage) {\n'''
normal_ai_new = '''    const aiResponse = await generateChat({\n      model: gatewayStatus.model,\n      instructions: UNBOUND_SYSTEM_PROMPT + "\\n\\n" + depthInstructions,\n      input\n    });\n\n    if (persistentChat) {\n      await persistAssistantMessage(\n        persistentChat,\n        aiResponse.reply,\n        depthStyle\n      );\n    }\n\n    if (databaseReady && pool && aiResponse.usage) {\n'''
server = replace_once(server, normal_ai, normal_ai_new, "normal assistant persistence")

stream_ai = '''    const aiResponse = await streamChat({\n      model: gatewayStatus.model,\n      instructions: UNBOUND_SYSTEM_PROMPT + "\\n\\n" + depthInstructions,\n      input,\n      onDelta: async (delta) => {\n        writeEvent({ type: "delta", delta });\n      }\n    });\n\n    if (databaseReady && pool && aiResponse.usage) {\n'''
stream_ai_new = '''    const aiResponse = await streamChat({\n      model: gatewayStatus.model,\n      instructions: UNBOUND_SYSTEM_PROMPT + "\\n\\n" + depthInstructions,\n      input,\n      onDelta: async (delta) => {\n        writeEvent({ type: "delta", delta });\n      }\n    });\n\n    if (persistentChat) {\n      await persistAssistantMessage(\n        persistentChat,\n        aiResponse.reply,\n        depthStyle\n      );\n    }\n\n    if (databaseReady && pool && aiResponse.usage) {\n'''
server = replace_once(server, stream_ai, stream_ai_new, "stream assistant persistence")

server = replace_count(
    server,
    "        const sessionUser = await findSessionUser(req);\n",
    "        const sessionUser = persistentChat?.user || await findSessionUser(req);\n",
    2,
    "usage session reuse",
)

normal_response = '''    res.json({\n      reply: aiResponse.reply,\n      depthStyle,\n      provider: aiResponse.provider,\n      model: aiResponse.model\n    });\n'''
normal_response_new = '''    res.json({\n      reply: aiResponse.reply,\n      depthStyle,\n      provider: aiResponse.provider,\n      model: aiResponse.model,\n      conversationId: persistentChat?.conversationId || null\n    });\n'''
server = replace_once(server, normal_response, normal_response_new, "normal conversation id")

stream_meta = '''    writeEvent({\n      type: "meta",\n      depthStyle,\n      provider: gatewayStatus.provider,\n      model: gatewayStatus.model\n    });\n'''
stream_meta_new = '''    writeEvent({\n      type: "meta",\n      depthStyle,\n      provider: gatewayStatus.provider,\n      model: gatewayStatus.model,\n      conversationId: persistentChat?.conversationId || null\n    });\n'''
server = replace_once(server, stream_meta, stream_meta_new, "stream meta conversation id")

stream_done = '''    writeEvent({\n      type: "done",\n      depthStyle,\n      provider: aiResponse.provider,\n      model: aiResponse.model\n    });\n'''
stream_done_new = '''    writeEvent({\n      type: "done",\n      depthStyle,\n      provider: aiResponse.provider,\n      model: aiResponse.model,\n      conversationId: persistentChat?.conversationId || null\n    });\n'''
server = replace_once(server, stream_done, stream_done_new, "stream done conversation id")

chat_error = '''    res.status(500).json({\n      error: error.message || "UNBOUND AI could not get a response."\n    });\n'''
chat_error_new = '''    res.status(error.statusCode || 500).json({\n      error: error.message || "UNBOUND AI could not get a response."\n    });\n'''
server = replace_count(server, chat_error, chat_error_new, 2, "chat error statuses")

# ----------------------------- FRONTEND -----------------------------
history_css = r'''
    .history-list {
      display: flex;
      flex-direction: column;
      gap: 9px;
      max-height: min(58vh, 520px);
      overflow-y: auto;
    }

    .history-item {
      display: flex;
      align-items: stretch;
      gap: 8px;
      padding: 8px;
      border: 1px solid rgba(107, 193, 255, 0.18);
      border-radius: 12px;
      background: rgba(8, 16, 29, 0.70);
    }

    .history-item.active {
      border-color: rgba(255, 173, 67, 0.46);
      background: rgba(255, 173, 67, 0.08);
    }

    .history-open {
      flex: 1 1 auto;
      min-width: 0;
      padding: 8px 10px;
      border: 0;
      background: transparent;
      color: var(--text);
      text-align: left;
      cursor: pointer;
    }

    .history-title {
      overflow: hidden;
      font-weight: 800;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .history-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 11px;
    }

    .history-delete {
      flex: 0 0 auto;
      align-self: center;
      padding: 8px 9px;
      border: 1px solid rgba(255, 118, 118, 0.28);
      border-radius: 9px;
      background: rgba(98, 21, 28, 0.28);
      color: #ffd0d0;
      cursor: pointer;
      font-size: 10px;
      font-weight: 800;
    }

    .history-empty {
      padding: 24px 12px;
      color: var(--muted);
      text-align: center;
      line-height: 1.5;
    }
'''
index = replace_once(index, "  </style>\n", history_css + "  </style>\n", "history css")

index = replace_once(
    index,
    '          <div class="age">18+ PLATFORM</div>\n          <button id="newChatButton" class="new-chat" type="button">NEW CHAT</button>',
    '          <div class="age">18+ PLATFORM</div>\n          <button id="historyButton" class="new-chat" type="button" hidden>HISTORY</button>\n          <button id="newChatButton" class="new-chat" type="button">NEW CHAT</button>',
    "history button",
)

history_modal = r'''  <div id="historyModal" class="auth-modal" hidden>
    <section class="auth-card" role="dialog" aria-modal="true" aria-labelledby="historyTitle">
      <div class="auth-card-head">
        <div>
          <h2 id="historyTitle">Conversation History</h2>
          <p>Your signed-in chats are saved to your UNBOUND AI account and can follow you between devices.</p>
        </div>
        <button id="historyCloseButton" class="auth-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="auth-body">
        <div id="historyFeedback" class="auth-feedback" role="status" aria-live="polite"></div>
        <div id="historyList" class="history-list"></div>
      </div>
    </section>
  </div>

'''
index = replace_once(index, '  <div id="authModal" class="auth-modal" hidden>\n', history_modal + '  <div id="authModal" class="auth-modal" hidden>\n', "history modal")

frontend_refs = r'''    const historyButton = document.getElementById("historyButton");
    const historyModal = document.getElementById("historyModal");
    const historyCloseButton = document.getElementById("historyCloseButton");
    const historyList = document.getElementById("historyList");
    const historyFeedback = document.getElementById("historyFeedback");
'''
index = replace_once(
    index,
    '    const messages = document.getElementById("messages");\n',
    '    const messages = document.getElementById("messages");\n' + frontend_refs,
    "history refs",
)

index = replace_once(
    index,
    '    let currentUser = null;\n    let conversationHistory = [];\n',
    '    let currentUser = null;\n    let activeConversationId = null;\n    let conversationHistory = [];\n',
    "active conversation state",
)

old_save_switch = r'''    function saveConversation() {
      try {
        conversationHistory = normalizeHistory(conversationHistory);
        localStorage.setItem(storageKey(), JSON.stringify(conversationHistory));
      } catch (error) {
        console.warn("Could not save UNBOUND AI chat history:", error);
      }
    }

    function switchConversationScope() {
      conversationHistory = loadConversation();
      depthStyle = loadDepthStyle();
      renderDepthStyle();
      renderConversation();
    }
'''
new_save_switch = r'''    function saveConversation() {
      if (currentUser) {
        return;
      }

      try {
        conversationHistory = normalizeHistory(conversationHistory);
        localStorage.setItem(storageKey(), JSON.stringify(conversationHistory));
      } catch (error) {
        console.warn("Could not save UNBOUND AI chat history:", error);
      }
    }

    async function fetchServerConversationList(limit = 50) {
      const response = await fetch(`/api/conversations?limit=${encodeURIComponent(limit)}`, {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || "Could not load conversation history.");
      }
      return Array.isArray(data.conversations) ? data.conversations : [];
    }

    async function loadServerConversation(conversationId) {
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
      depthStyle = normalizeDepthStyle(data.conversation?.depthStyle || loadDepthStyle());
      saveDepthStyle();
      renderDepthStyle();
      renderConversation();
    }

    async function importLegacyConversationIfNeeded() {
      const legacy = loadConversation();
      if (!legacy.length) {
        return false;
      }

      const response = await fetch("/api/conversations/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: legacy, depthStyle: loadDepthStyle() })
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || "Could not import your existing chat.");
      }

      activeConversationId = String(data.conversation?.id || "") || null;
      conversationHistory = normalizeHistory(data.messages || legacy);
      localStorage.removeItem(storageKey());
      return true;
    }

    async function switchConversationScope() {
      depthStyle = loadDepthStyle();

      if (!currentUser) {
        activeConversationId = null;
        conversationHistory = loadConversation();
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
      renderDepthStyle();
      renderConversation();
    }
'''
index = replace_once(index, old_save_switch, new_save_switch, "server conversation frontend")

old_new_chat = r'''    function startNewChat() {
      const hasHistory = conversationHistory.length > 0;

      if (hasHistory) {
        const confirmed = window.confirm(
          "Start a new chat? This will clear this conversation from this browser."
        );

        if (!confirmed) {
          return;
        }
      }

      conversationHistory = [];
      localStorage.removeItem(storageKey());
      renderConversation();
      updateGoDeeperVisibility();
      input.value = "";
      input.focus();
    }
'''
new_new_chat = r'''    function startNewChat() {
      const hasHistory = conversationHistory.length > 0;

      if (hasHistory) {
        const confirmed = window.confirm(
          currentUser
            ? "Start a new chat? Your current conversation will stay in History."
            : "Start a new chat? This will clear this guest conversation from this browser."
        );

        if (!confirmed) {
          return;
        }
      }

      activeConversationId = null;
      conversationHistory = [];
      if (!currentUser) {
        localStorage.removeItem(storageKey());
      }
      renderConversation();
      updateGoDeeperVisibility();
      input.value = "";
      input.focus();
    }
'''
index = replace_once(index, old_new_chat, new_new_chat, "new chat behavior")

index = replace_once(
    index,
    '''            message,\n            history: priorHistory,\n            depthStyle\n''',
    '''            message,\n            history: priorHistory,\n            depthStyle,\n            conversationId: currentUser ? activeConversationId : null\n''',
    "send conversation id",
)

index = replace_once(
    index,
    '''          const event = JSON.parse(line);\n\n          if (event.type === "delta" && typeof event.delta === "string") {\n''',
    '''          const event = JSON.parse(line);\n\n          if (event.type === "meta" && event.conversationId) {\n            activeConversationId = String(event.conversationId);\n          }\n\n          if (event.type === "delta" && typeof event.delta === "string") {\n''',
    "stream conversation id handling",
)

history_functions = r'''    function closeHistory() {
      historyModal.hidden = true;
      if (authModal.hidden) {
        document.body.classList.remove("modal-open");
      }
    }

    function showHistoryFeedback(message, type = "error") {
      historyFeedback.className = `auth-feedback visible ${type}`;
      historyFeedback.textContent = message;
    }

    function clearHistoryFeedback() {
      historyFeedback.className = "auth-feedback";
      historyFeedback.textContent = "";
    }

    function formatHistoryDate(value) {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return "";
      return date.toLocaleString();
    }

    async function loadHistoryList() {
      clearHistoryFeedback();
      historyList.innerHTML = '<div class="history-empty">Loading your conversations…</div>';

      try {
        const conversations = await fetchServerConversationList(50);
        historyList.innerHTML = "";

        if (!conversations.length) {
          historyList.innerHTML = '<div class="history-empty">No saved conversations yet. Start chatting and they will appear here.</div>';
          return;
        }

        conversations.forEach((conversation) => {
          const item = document.createElement("div");
          item.className = "history-item";
          item.classList.toggle("active", String(conversation.id) === String(activeConversationId));

          const openButton = document.createElement("button");
          openButton.type = "button";
          openButton.className = "history-open";

          const title = document.createElement("div");
          title.className = "history-title";
          title.textContent = conversation.title || "New chat";

          const meta = document.createElement("div");
          meta.className = "history-meta";
          meta.textContent = `${conversation.messageCount || 0} messages • ${formatHistoryDate(conversation.updatedAt)}`;

          openButton.append(title, meta);
          openButton.addEventListener("click", async () => {
            try {
              await loadServerConversation(conversation.id);
              closeHistory();
              input.focus();
            } catch (error) {
              showHistoryFeedback(error.message || "Could not open that conversation.");
            }
          });

          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "history-delete";
          deleteButton.textContent = "DELETE";
          deleteButton.addEventListener("click", async () => {
            const confirmed = window.confirm(`Delete “${conversation.title || "New chat"}”? This cannot be undone.`);
            if (!confirmed) return;

            try {
              const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, {
                method: "DELETE",
                credentials: "same-origin",
                headers: { "Accept": "application/json" }
              });
              const data = await readJson(response);
              if (!response.ok) {
                throw new Error(data.error || "Could not delete that conversation.");
              }

              if (String(activeConversationId) === String(conversation.id)) {
                activeConversationId = null;
                conversationHistory = [];
                renderConversation();
              }
              await loadHistoryList();
            } catch (error) {
              showHistoryFeedback(error.message || "Could not delete that conversation.");
            }
          });

          item.append(openButton, deleteButton);
          historyList.appendChild(item);
        });
      } catch (error) {
        historyList.innerHTML = "";
        showHistoryFeedback(error.message || "Could not load conversation history.");
      }
    }

    async function openHistory() {
      if (!currentUser) {
        showToast("Sign in to use server-saved conversation history.");
        return;
      }

      historyModal.hidden = false;
      document.body.classList.add("modal-open");
      await loadHistoryList();
    }

'''
index = replace_once(
    index,
    "    function setAuthMode(mode) {\n",
    history_functions + "    function setAuthMode(mode) {\n",
    "history functions",
)

index = replace_once(
    index,
    '''        adminButton.hidden = currentUser.role !== "admin";\n        return;\n''',
    '''        adminButton.hidden = currentUser.role !== "admin";\n        historyButton.hidden = false;\n        return;\n''',
    "signed in history button",
)
index = replace_once(
    index,
    '''      adminButton.hidden = true;\n    }\n''',
    '''      adminButton.hidden = true;\n      historyButton.hidden = true;\n    }\n''',
    "signed out history button",
)

index = replace_count(
    index,
    "        switchConversationScope();\n",
    "        await switchConversationScope();\n",
    2,
    "login register server switch",
)
index = replace_once(
    index,
    "      switchConversationScope();\n      logoutButton.disabled = false;\n",
    "      await switchConversationScope();\n      logoutButton.disabled = false;\n",
    "logout server switch",
)

index = replace_once(
    index,
    '    newChatButton.addEventListener("click", startNewChat);\n',
    '    newChatButton.addEventListener("click", startNewChat);\n    historyButton.addEventListener("click", openHistory);\n    historyCloseButton.addEventListener("click", closeHistory);\n',
    "history listeners",
)

index = replace_once(
    index,
    '''    authModal.addEventListener("click", (event) => {\n      if (event.target === authModal) {\n        closeAuth();\n      }\n    });\n\n''',
    '''    authModal.addEventListener("click", (event) => {\n      if (event.target === authModal) {\n        closeAuth();\n      }\n    });\n\n    historyModal.addEventListener("click", (event) => {\n      if (event.target === historyModal) {\n        closeHistory();\n      }\n    });\n\n''',
    "history modal backdrop",
)

old_escape = r'''    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !authModal.hidden) {
        closeAuth();
      }
    });
'''
new_escape = r'''    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!historyModal.hidden) {
        closeHistory();
        return;
      }
      if (!authModal.hidden) {
        closeAuth();
      }
    });
'''
index = replace_once(index, old_escape, new_escape, "escape modal handling")

old_init = r'''    async function initializePage() {
      renderAccountUi();
      await loadCurrentUser();
      conversationHistory = loadConversation();
      depthStyle = loadDepthStyle();
      renderDepthStyle();
      renderConversation();
    }
'''
new_init = r'''    async function initializePage() {
      renderAccountUi();
      await loadCurrentUser();
      await switchConversationScope();
    }
'''
index = replace_once(index, old_init, new_init, "server history initialization")

server_path.write_text(server)
index_path.write_text(index)
print("Server-side conversation history migration applied.")
