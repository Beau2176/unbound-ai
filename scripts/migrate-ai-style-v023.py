from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    path.write_text(text.replace(old, new, 1))


def many(path, old, new, expected, label):
    text = path.read_text()
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'{label}: expected {expected} matches, found {count}')
    path.write_text(text.replace(old, new))


server = Path('app/server.js')
index = Path('app/index.html')

# Server imports trusted, fixed AI style definitions. User input can select a style ID
# but can never inject arbitrary system instructions.
one(
    server,
'''const {
  getSignInRiskConfig,
  buildRepeatedFailureAlert,
  getSignInRiskStatus
} = require("./security/signin-risk");
''',
'''const {
  getSignInRiskConfig,
  buildRepeatedFailureAlert,
  getSignInRiskStatus
} = require("./security/signin-risk");
const {
  normalizeAiStyle,
  getAiStylePrompt,
  listAiStyles
} = require("./preferences/ai-style");
''',
    'AI style imports'
)

# Persist signed-in style choices so the preference follows the account across devices.
one(
    server,
'''    CREATE TABLE IF NOT EXISTS user_sessions (
''',
'''    CREATE TABLE IF NOT EXISTS user_ai_preferences (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ai_style TEXT NOT NULL DEFAULT 'balanced',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
''',
    'AI style preference table'
)

preferences_block = r'''
function publicAiPreferences(row) {
  return {
    aiStyle: normalizeAiStyle(row?.ai_style),
    updatedAt: row?.updated_at || null
  };
}

async function loadAiPreferences(userId, client = pool) {
  const result = await client.query(
    `SELECT ai_style, updated_at
     FROM user_ai_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  return publicAiPreferences(result.rows[0] || null);
}

async function resolveAiStyleForRequest(req, knownUser = null) {
  const user = knownUser || (databaseReady && pool ? await findSessionUser(req) : null);
  if (user && databaseReady && pool) {
    return (await loadAiPreferences(user.id)).aiStyle;
  }
  return normalizeAiStyle(req.body?.aiStyle);
}

app.get(
  "/api/account/ai-preferences",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      return res.json({
        preferences: await loadAiPreferences(req.user.id),
        styles: listAiStyles()
      });
    } catch (error) {
      console.error("UNBOUND AI AI PREFERENCE LOAD ERROR:", error);
      return res.status(500).json({ error: "Could not load AI style preferences." });
    }
  }
);

app.post(
  "/api/account/ai-preferences",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const requested = String(req.body?.aiStyle || "").trim().toLowerCase();
      const normalized = normalizeAiStyle(requested);
      if (!requested || requested !== normalized) {
        return res.status(400).json({
          error: "Choose a supported UNBOUND AI style.",
          styles: listAiStyles()
        });
      }

      const result = await pool.query(
        `INSERT INTO user_ai_preferences (user_id, ai_style, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET ai_style = EXCLUDED.ai_style, updated_at = NOW()
         RETURNING ai_style, updated_at`,
        [req.user.id, normalized]
      );

      return res.json({
        ok: true,
        preferences: publicAiPreferences(result.rows[0]),
        styles: listAiStyles()
      });
    } catch (error) {
      console.error("UNBOUND AI AI PREFERENCE SAVE ERROR:", error);
      return res.status(500).json({ error: "Could not save AI style preferences." });
    }
  }
);

'''
one(
    server,
'''/* ------------------------- CONVERSATION HISTORY ------------------------ */
''',
preferences_block + '''/* ------------------------- CONVERSATION HISTORY ------------------------ */
''',
    'AI style API block'
)

# Resolve account preference (or validated guest preference) for both normal and
# streaming chat routes.
many(
    server,
'''    const persistentChat = await preparePersistentChat(
      req,
      message,
      depthStyle,
      productMode
    );
    const history = persistentChat
''',
'''    const persistentChat = await preparePersistentChat(
      req,
      message,
      depthStyle,
      productMode
    );
    const aiStyle = await resolveAiStyleForRequest(req, persistentChat?.user || null);
    const styleInstructions = getAiStylePrompt(aiStyle);
    const history = persistentChat
''',
    2,
    'chat AI style resolution'
)

many(
    server,
'''      instructions: [UNBOUND_SYSTEM_PROMPT, depthInstructions, modeInstructions]
''',
'''      instructions: [UNBOUND_SYSTEM_PROMPT, styleInstructions, depthInstructions, modeInstructions]
''',
    2,
    'chat AI style prompt composition'
)

# Non-stream response plus stream meta/done report the active style.
many(
    server,
'''      depthStyle,
      productMode,
      provider: ''',
'''      depthStyle,
      productMode,
      aiStyle,
      provider: ''',
    3,
    'AI style response metadata'
)

# Browser controls: a style selector is independent of product mode and Casual/Work.
one(
    index,
'''    .depth-button.active[data-depth-style="work"] {
      background: rgba(255, 173, 67, 0.16);
      color: #ffd297;
      box-shadow: inset 0 0 0 1px rgba(255, 173, 67, 0.22);
    }


    .product-control {
''',
'''    .depth-button.active[data-depth-style="work"] {
      background: rgba(255, 173, 67, 0.16);
      color: #ffd297;
      box-shadow: inset 0 0 0 1px rgba(255, 173, 67, 0.22);
    }

    .style-control {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 7px;
      border: 1px solid rgba(101, 232, 164, 0.24);
      border-radius: 10px;
      background: rgba(4, 18, 14, 0.68);
    }

    .style-control span {
      color: #9fc9b3;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.07em;
    }

    .style-control select {
      max-width: 138px;
      border: 0;
      outline: 0;
      background: transparent;
      color: #dfffee;
      cursor: pointer;
      font-size: 10px;
      font-weight: 800;
    }

    .style-control option {
      background: #08121a;
      color: #f7fbff;
    }


    .product-control {
''',
    'AI style CSS'
)

one(
    index,
'''          <div class="depth-control" role="group" aria-label="Response depth">
            <button id="casualModeButton" class="depth-button active" data-depth-style="casual" type="button" aria-pressed="true">CASUAL</button>
            <button id="workModeButton" class="depth-button" data-depth-style="work" type="button" aria-pressed="false">WORK</button>
          </div>
          <div class="age">18+ PLATFORM</div>
''',
'''          <div class="depth-control" role="group" aria-label="Response depth">
            <button id="casualModeButton" class="depth-button active" data-depth-style="casual" type="button" aria-pressed="true">CASUAL</button>
            <button id="workModeButton" class="depth-button" data-depth-style="work" type="button" aria-pressed="false">WORK</button>
          </div>
          <label class="style-control" for="aiStyleSelect">
            <span>STYLE</span>
            <select id="aiStyleSelect" aria-label="AI conversation style">
              <option value="balanced">BALANCED</option>
              <option value="straight">STRAIGHT SHOOTER</option>
              <option value="professional">PROFESSIONAL</option>
              <option value="warm">WARM</option>
              <option value="playful">PLAYFUL</option>
            </select>
          </label>
          <div class="age">18+ PLATFORM</div>
''',
    'AI style selector'
)

one(
    index,
'''          <div class="hint"><span id="productStatus" class="depth-status">Standard Mode</span> • <span id="depthStatus" class="depth-status">Casual Mode — Fast answers when you need them.</span> • Enter to send • Shift + Enter for a new line</div>
''',
'''          <div class="hint"><span id="productStatus" class="depth-status">Standard Mode</span> • <span id="depthStatus" class="depth-status">Casual Mode — Fast answers when you need them.</span> • <span id="styleStatus" class="depth-status">Balanced style</span> • Enter to send • Shift + Enter for a new line</div>
''',
    'AI style status'
)

one(
    index,
'''    const PRODUCT_MODE_KEY_BASE = "unbound-ai-product-mode-v1";
''',
'''    const PRODUCT_MODE_KEY_BASE = "unbound-ai-product-mode-v1";
    const AI_STYLE_KEY_BASE = "unbound-ai-style-v1";
''',
    'AI style storage key'
)

one(
    index,
'''    const productStatus = document.getElementById("productStatus");
    const casualModeButton = document.getElementById("casualModeButton");
''',
'''    const productStatus = document.getElementById("productStatus");
    const aiStyleSelect = document.getElementById("aiStyleSelect");
    const styleStatus = document.getElementById("styleStatus");
    const casualModeButton = document.getElementById("casualModeButton");
''',
    'AI style DOM refs'
)

one(
    index,
'''    let productMode = "standard";
    let depthStyle = "casual";
''',
'''    let productMode = "standard";
    let depthStyle = "casual";
    let aiStyle = "balanced";
''',
    'AI style state'
)

style_functions = r'''
    function aiStyleStorageKey() {
      if (currentUser && currentUser.id) {
        return `${AI_STYLE_KEY_BASE}-user-${currentUser.id}`;
      }
      return `${AI_STYLE_KEY_BASE}-guest`;
    }

    function normalizeAiStyle(value) {
      return ["balanced", "straight", "professional", "warm", "playful"].includes(value)
        ? value
        : "balanced";
    }

    function aiStyleLabel(value) {
      return ({
        balanced: "Balanced",
        straight: "Straight Shooter",
        professional: "Professional",
        warm: "Warm",
        playful: "Playful"
      })[normalizeAiStyle(value)];
    }

    function loadAiStyle() {
      try {
        return normalizeAiStyle(localStorage.getItem(aiStyleStorageKey()));
      } catch (error) {
        console.warn("Could not load UNBOUND AI style:", error);
        return "balanced";
      }
    }

    function saveAiStyleLocal() {
      try {
        localStorage.setItem(aiStyleStorageKey(), aiStyle);
      } catch (error) {
        console.warn("Could not save UNBOUND AI style locally:", error);
      }
    }

    function renderAiStyle() {
      aiStyleSelect.value = normalizeAiStyle(aiStyle);
      styleStatus.textContent = `${aiStyleLabel(aiStyle)} style`;
    }

    async function syncAiStyleForScope() {
      if (!currentUser) {
        aiStyle = loadAiStyle();
        renderAiStyle();
        return;
      }

      try {
        const response = await fetch("/api/account/ai-preferences", {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Could not load AI style.");
        aiStyle = normalizeAiStyle(data.preferences?.aiStyle);
        saveAiStyleLocal();
      } catch (error) {
        console.warn("Could not sync UNBOUND AI style:", error);
        aiStyle = loadAiStyle();
      }
      renderAiStyle();
    }

    async function handleAiStyleChange() {
      const previous = aiStyle;
      aiStyle = normalizeAiStyle(aiStyleSelect.value);
      saveAiStyleLocal();
      renderAiStyle();

      if (currentUser) {
        try {
          const response = await fetch("/api/account/ai-preferences", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aiStyle })
          });
          const data = await readJson(response);
          if (!response.ok) throw new Error(data.error || "Could not save AI style.");
          aiStyle = normalizeAiStyle(data.preferences?.aiStyle);
          saveAiStyleLocal();
          renderAiStyle();
        } catch (error) {
          aiStyle = previous;
          saveAiStyleLocal();
          renderAiStyle();
          showToast(error.message || "Could not save AI style.");
          return;
        }
      }

      showToast(`${aiStyleLabel(aiStyle)} style is active.`);
    }

'''
one(
    index,
'''    function normalizeHistory(items) {
''',
style_functions + '''    function normalizeHistory(items) {
''',
    'AI style browser functions'
)

one(
    index,
'''    async function switchConversationScope() {
      productMode = safeProductMode(loadProductMode());
''',
'''    async function switchConversationScope() {
      await syncAiStyleForScope();
      productMode = safeProductMode(loadProductMode());
''',
    'AI style scope sync'
)

# Both Research and streaming requests carry the validated guest style. Signed-in
# requests are authoritative from the server-side account preference row.
many(
    index,
'''              depthStyle,
              productMode,
              conversationId: currentUser ? activeConversationId : null
''',
'''              depthStyle,
              productMode,
              aiStyle,
              conversationId: currentUser ? activeConversationId : null
''',
    1,
    'AI style research request'
)

many(
    index,
'''            depthStyle,
            productMode,
            conversationId: currentUser ? activeConversationId : null
''',
'''            depthStyle,
            productMode,
            aiStyle,
            conversationId: currentUser ? activeConversationId : null
''',
    1,
    'AI style streaming request'
)

one(
    index,
'''          localStorage.removeItem(`${PRODUCT_MODE_KEY_BASE}-user-${deletedUserId}`);
''',
'''          localStorage.removeItem(`${PRODUCT_MODE_KEY_BASE}-user-${deletedUserId}`);
          localStorage.removeItem(`${AI_STYLE_KEY_BASE}-user-${deletedUserId}`);
''',
    'AI style account deletion cleanup'
)

one(
    index,
'''    goDeeperButton.addEventListener("click", goDeeper);
''',
'''    goDeeperButton.addEventListener("click", goDeeper);
    aiStyleSelect.addEventListener("change", handleAiStyleChange);
''',
    'AI style change listener'
)

one(
    index,
'''      renderAccountUi();
      await loadCurrentUser();
      await switchConversationScope();
''',
'''      renderAccountUi();
      renderAiStyle();
      await loadCurrentUser();
      await switchConversationScope();
''',
    'AI style page initialization'
)

print('Applied UNBOUND AI v0.23 account-backed AI style preferences.')
