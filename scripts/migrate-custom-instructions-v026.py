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

one(
    server,
'''const {
  buildExportFilename,
  buildDataExport
} = require("./privacy/data-export");
''',
'''const {
  buildExportFilename,
  buildDataExport
} = require("./privacy/data-export");
const {
  MAX_CUSTOM_INSTRUCTIONS,
  customInstructionsAreValid,
  normalizeCustomInstructions,
  buildCustomInstructionsMessage
} = require("./preferences/custom-instructions");
''',
    'custom instruction imports'
)

one(
    server,
'''    CREATE TABLE IF NOT EXISTS user_ai_preferences (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ai_style TEXT NOT NULL DEFAULT 'balanced',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
''',
'''    CREATE TABLE IF NOT EXISTS user_ai_preferences (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ai_style TEXT NOT NULL DEFAULT 'balanced',
      custom_instructions TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE user_ai_preferences
      ADD COLUMN IF NOT EXISTS custom_instructions TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS user_sessions (
''',
    'custom instruction database column'
)

one(
    server,
'''function publicAiPreferences(row) {
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
''',
'''function publicAiPreferences(row) {
  return {
    aiStyle: normalizeAiStyle(row?.ai_style),
    customInstructions: normalizeCustomInstructions(row?.custom_instructions),
    updatedAt: row?.updated_at || null
  };
}

async function loadAiPreferences(userId, client = pool) {
  const result = await client.query(
    `SELECT ai_style, custom_instructions, updated_at
     FROM user_ai_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  return publicAiPreferences(result.rows[0] || null);
}

async function resolveAiPreferencesForRequest(req, knownUser = null) {
  const user = knownUser || (databaseReady && pool ? await findSessionUser(req) : null);
  if (user && databaseReady && pool) {
    return loadAiPreferences(user.id);
  }
  return {
    aiStyle: normalizeAiStyle(req.body?.aiStyle),
    customInstructions: "",
    updatedAt: null
  };
}
''',
    'custom instruction preference helpers'
)

one(
    server,
'''app.post(
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
''',
'''app.post(
  "/api/account/ai-preferences",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const hasAiStyle = Object.prototype.hasOwnProperty.call(body, "aiStyle");
      const hasCustomInstructions = Object.prototype.hasOwnProperty.call(
        body,
        "customInstructions"
      );

      if (!hasAiStyle && !hasCustomInstructions) {
        return res.status(400).json({
          error: "Provide an AI style or custom instructions to update."
        });
      }

      const current = await loadAiPreferences(req.user.id);
      let aiStyle = current.aiStyle;
      let customInstructions = current.customInstructions;

      if (hasAiStyle) {
        const requested = String(body.aiStyle || "").trim().toLowerCase();
        const normalized = normalizeAiStyle(requested);
        if (!requested || requested !== normalized) {
          return res.status(400).json({
            error: "Choose a supported UNBOUND AI style.",
            styles: listAiStyles()
          });
        }
        aiStyle = normalized;
      }

      if (hasCustomInstructions) {
        if (!customInstructionsAreValid(body.customInstructions)) {
          return res.status(400).json({
            error: `Custom instructions must be text no longer than ${MAX_CUSTOM_INSTRUCTIONS} characters.`
          });
        }
        customInstructions = normalizeCustomInstructions(body.customInstructions);
      }

      const result = await pool.query(
        `INSERT INTO user_ai_preferences (
           user_id, ai_style, custom_instructions, updated_at
         )
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           ai_style = EXCLUDED.ai_style,
           custom_instructions = EXCLUDED.custom_instructions,
           updated_at = NOW()
         RETURNING ai_style, custom_instructions, updated_at`,
        [req.user.id, aiStyle, customInstructions]
      );

      return res.json({
        ok: true,
        preferences: publicAiPreferences(result.rows[0]),
        styles: listAiStyles()
      });
    } catch (error) {
      console.error("UNBOUND AI AI PREFERENCE SAVE ERROR:", error);
      return res.status(500).json({ error: "Could not save AI preferences." });
    }
  }
);
''',
    'partial AI preference update API'
)

many(
    server,
'''    const aiStyle = await resolveAiStyleForRequest(req, persistentChat?.user || null);
    const styleInstructions = getAiStylePrompt(aiStyle);
''',
'''    const aiPreferences = await resolveAiPreferencesForRequest(
      req,
      persistentChat?.user || null
    );
    const aiStyle = aiPreferences.aiStyle;
    const customPreferenceMessage = buildCustomInstructionsMessage(
      aiPreferences.customInstructions
    );
    const styleInstructions = getAiStylePrompt(aiStyle);
''',
    2,
    'chat custom instruction resolution'
)

one(
    server,
'''    const input = [
      ...history,
      {
        role: "user",
        content: message.slice(0, 12000)
      }
    ];
''',
'''    const input = [
      ...(customPreferenceMessage ? [customPreferenceMessage] : []),
      ...history,
      {
        role: "user",
        content: message.slice(0, 12000)
      }
    ];
''',
    'non-stream custom instruction input'
)

one(
    server,
'''    const input = [
      ...history,
      { role: "user", content: message.slice(0, 12000) }
    ];
''',
'''    const input = [
      ...(customPreferenceMessage ? [customPreferenceMessage] : []),
      ...history,
      { role: "user", content: message.slice(0, 12000) }
    ];
''',
    'stream custom instruction input'
)

# UI styles for account-backed standing preferences.
one(
    index,
'''    .capability-list { display: grid; gap: 8px; }
''',
'''    .preference-textarea {
      width: 100%;
      min-height: 132px;
      resize: vertical;
      padding: 11px 12px;
      border: 1px solid rgba(107, 193, 255, 0.22);
      border-radius: 11px;
      outline: none;
      background: rgba(2, 8, 18, 0.72);
      color: #f3f9ff;
      font-size: 12px;
      line-height: 1.5;
    }
    .preference-textarea:focus {
      border-color: rgba(107, 193, 255, 0.62);
      box-shadow: 0 0 0 3px rgba(66, 165, 255, 0.08);
    }
    .preference-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 8px;
    }
    .preference-count {
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
    }
    .preference-save {
      min-height: 38px;
      padding: 8px 12px;
    }

    .capability-list { display: grid; gap: 8px; }
''',
    'custom instruction CSS'
)

one(
    index,
'''        <div class="access-section-title">Your data</div>
        <button id="dataExportButton" class="auth-submit secondary" type="button">DOWNLOAD MY DATA</button>
''',
'''        <div class="access-section-title">Custom instructions</div>
        <textarea id="customInstructionsInput" class="preference-textarea" maxlength="2000" placeholder="Tell UNBOUND how you prefer answers framed, recurring context, formatting preferences, or other standing guidance."></textarea>
        <div class="preference-footer">
          <span id="customInstructionsCount" class="preference-count">0 / 2000</span>
          <button id="customInstructionsSaveButton" class="auth-submit secondary preference-save" type="button">SAVE INSTRUCTIONS</button>
        </div>
        <p class="auth-note">Saved to your account and applied as user-level preferences. They cannot override platform safety, security, privacy, factuality, product-mode, or tool-use rules.</p>
        <div class="access-section-title">Your data</div>
        <button id="dataExportButton" class="auth-submit secondary" type="button">DOWNLOAD MY DATA</button>
''',
    'custom instruction account UI'
)

one(
    index,
'''    const accessCapabilityList = document.getElementById("accessCapabilityList");
    const dataExportButton = document.getElementById("dataExportButton");
''',
'''    const accessCapabilityList = document.getElementById("accessCapabilityList");
    const customInstructionsInput = document.getElementById("customInstructionsInput");
    const customInstructionsCount = document.getElementById("customInstructionsCount");
    const customInstructionsSaveButton = document.getElementById("customInstructionsSaveButton");
    const dataExportButton = document.getElementById("dataExportButton");
''',
    'custom instruction DOM refs'
)

one(
    index,
'''    let aiStyle = "balanced";
    let toastTimer = null;
''',
'''    let aiStyle = "balanced";
    let customInstructions = "";
    let toastTimer = null;
''',
    'custom instruction browser state'
)

one(
    index,
'''    function renderAiStyle() {
      aiStyleSelect.value = normalizeAiStyle(aiStyle);
      styleStatus.textContent = `${aiStyleLabel(aiStyle)} style`;
    }

    async function syncAiStyleForScope() {
''',
'''    function renderAiStyle() {
      aiStyleSelect.value = normalizeAiStyle(aiStyle);
      styleStatus.textContent = `${aiStyleLabel(aiStyle)} style`;
    }

    function renderCustomInstructions() {
      if (document.activeElement !== customInstructionsInput) {
        customInstructionsInput.value = customInstructions;
      }
      customInstructionsCount.textContent = `${customInstructionsInput.value.length} / 2000`;
      customInstructionsSaveButton.disabled = !currentUser;
    }

    async function syncAiStyleForScope() {
''',
    'custom instruction render helper'
)

one(
    index,
'''    async function syncAiStyleForScope() {
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
''',
'''    async function syncAiStyleForScope() {
      if (!currentUser) {
        aiStyle = loadAiStyle();
        customInstructions = "";
        renderAiStyle();
        renderCustomInstructions();
        return;
      }

      try {
        const response = await fetch("/api/account/ai-preferences", {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        });
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Could not load AI preferences.");
        aiStyle = normalizeAiStyle(data.preferences?.aiStyle);
        customInstructions = String(data.preferences?.customInstructions || "");
        saveAiStyleLocal();
      } catch (error) {
        console.warn("Could not sync UNBOUND AI preferences:", error);
        aiStyle = loadAiStyle();
        customInstructions = "";
      }
      renderAiStyle();
      renderCustomInstructions();
    }
''',
    'custom instruction preference sync'
)

save_handler = r'''
    async function handleSaveCustomInstructions() {
      if (!currentUser || customInstructionsSaveButton.disabled) return;
      const nextValue = customInstructionsInput.value.trim();
      if (nextValue.length > 2000) {
        showToast("Custom instructions cannot exceed 2000 characters.");
        return;
      }

      customInstructionsSaveButton.disabled = true;
      customInstructionsSaveButton.textContent = "SAVING...";
      try {
        const response = await fetch("/api/account/ai-preferences", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customInstructions: nextValue })
        });
        const data = await readJson(response);
        if (!response.ok) {
          throw new Error(data.error || "Could not save custom instructions.");
        }
        aiStyle = normalizeAiStyle(data.preferences?.aiStyle);
        customInstructions = String(data.preferences?.customInstructions || "");
        saveAiStyleLocal();
        renderAiStyle();
        customInstructionsInput.value = customInstructions;
        renderCustomInstructions();
        showToast(customInstructions ? "Custom instructions saved." : "Custom instructions cleared.");
      } catch (error) {
        customInstructionsInput.value = customInstructions;
        renderCustomInstructions();
        showToast(error.message || "Could not save custom instructions.");
      } finally {
        customInstructionsSaveButton.disabled = false;
        customInstructionsSaveButton.textContent = "SAVE INSTRUCTIONS";
      }
    }

'''
one(
    index,
'''    async function handleAiStyleChange() {
''',
save_handler + '''    async function handleAiStyleChange() {
''',
    'custom instruction save handler'
)

one(
    index,
'''    goDeeperButton.addEventListener("click", goDeeper);
    aiStyleSelect.addEventListener("change", handleAiStyleChange);
''',
'''    goDeeperButton.addEventListener("click", goDeeper);
    aiStyleSelect.addEventListener("change", handleAiStyleChange);
    customInstructionsInput.addEventListener("input", renderCustomInstructions);
    customInstructionsSaveButton.addEventListener("click", handleSaveCustomInstructions);
''',
    'custom instruction listeners'
)

one(
    index,
'''      renderAccountUi();
      renderAiStyle();
      await loadCurrentUser();
''',
'''      renderAccountUi();
      renderAiStyle();
      renderCustomInstructions();
      await loadCurrentUser();
''',
    'custom instruction initialization'
)

print('Applied UNBOUND AI v0.26 account-backed custom instructions.')
