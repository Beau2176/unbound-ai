from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# ----------------------------- SERVER ---------------------------------
server_path = Path("app/server.js")
server = server_path.read_text()

security_routes = r'''

app.get(
  "/api/account/security",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const token = parseCookies(req)[SESSION_COOKIE];
      const tokenHash = token ? hashSessionToken(token) : null;
      const result = await pool.query(
        `SELECT
           COUNT(*)::int AS active_sessions,
           MAX(CASE WHEN token_hash = $2 THEN expires_at END) AS current_expires_at
         FROM user_sessions
         WHERE user_id = $1
           AND expires_at > NOW()`,
        [req.user.id, tokenHash]
      );

      return res.json({
        activeSessions: Number(result.rows[0]?.active_sessions || 0),
        currentSessionExpiresAt: result.rows[0]?.current_expires_at || null
      });
    } catch (error) {
      console.error("UNBOUND AI ACCOUNT SECURITY STATUS ERROR:", error);
      return res.status(500).json({ error: "Could not load account security status." });
    }
  }
);

app.post(
  "/api/account/password",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    const currentPassword =
      typeof req.body.currentPassword === "string"
        ? req.body.currentPassword
        : "";
    const newPassword =
      typeof req.body.newPassword === "string" ? req.body.newPassword : "";
    const newPasswordConfirm =
      typeof req.body.newPasswordConfirm === "string"
        ? req.body.newPasswordConfirm
        : "";

    if (!currentPassword || currentPassword.length > 200) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    if (newPassword.length < 12 || newPassword.length > 200) {
      return res.status(400).json({
        error: "New password must be between 12 and 200 characters."
      });
    }

    if (newPassword !== newPasswordConfirm) {
      return res.status(400).json({ error: "The new passwords do not match." });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash
         FROM users
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [req.user.id]
      );
      const user = userResult.rows[0];

      if (!user) {
        await client.query("ROLLBACK");
        clearSessionCookie(res);
        return res.status(404).json({ error: "Account not found." });
      }

      if (!(await verifyPassword(currentPassword, user.password_hash))) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      if (await verifyPassword(newPassword, user.password_hash)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Choose a new password that is different from your current password."
        });
      }

      const nextHash = await hashPassword(newPassword);
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [nextHash, user.id]
      );

      const revoked = await client.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1
         RETURNING id`,
        [user.id]
      );

      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = hashSessionToken(token);
      await client.query(
        `INSERT INTO user_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`,
        [user.id, tokenHash]
      );

      await client.query("COMMIT");
      setSessionCookie(res, token);

      return res.json({
        ok: true,
        passwordChanged: true,
        otherSessionsRevoked: Math.max(Number(revoked.rowCount || 0) - 1, 0),
        activeSessions: 1
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("UNBOUND AI PASSWORD CHANGE ROLLBACK ERROR:", rollbackError);
      }
      console.error("UNBOUND AI PASSWORD CHANGE ERROR:", error);
      return res.status(500).json({ error: "Could not change the password." });
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/account/sessions/revoke-others",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    const token = parseCookies(req)[SESSION_COOKIE];

    if (!password || password.length > 200) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    if (!token) {
      return res.status(401).json({ error: "Your current session is not available." });
    }

    const tokenHash = hashSessionToken(token);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `SELECT id, password_hash
         FROM users
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [req.user.id]
      );
      const user = userResult.rows[0];

      if (!user || !(await verifyPassword(password, user.password_hash))) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      const currentResult = await client.query(
        `SELECT id
         FROM user_sessions
         WHERE user_id = $1
           AND token_hash = $2
           AND expires_at > NOW()
         LIMIT 1`,
        [user.id, tokenHash]
      );

      if (!currentResult.rows[0]) {
        await client.query("ROLLBACK");
        clearSessionCookie(res);
        return res.status(401).json({ error: "Your current session has expired." });
      }

      const revoked = await client.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1
           AND token_hash <> $2
         RETURNING id`,
        [user.id, tokenHash]
      );

      await client.query("COMMIT");
      return res.json({
        ok: true,
        revokedSessions: Number(revoked.rowCount || 0),
        activeSessions: 1
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("UNBOUND AI SESSION REVOCATION ROLLBACK ERROR:", rollbackError);
      }
      console.error("UNBOUND AI SESSION REVOCATION ERROR:", error);
      return res.status(500).json({ error: "Could not revoke other sessions." });
    } finally {
      client.release();
    }
  }
);
'''

server = replace_once(
    server,
    '''app.delete(\n  "/api/account",''',
    security_routes + '\napp.delete(\n  "/api/account",',
    "security routes insertion",
)
server_path.write_text(server)


# ------------------------------ INDEX ---------------------------------
index_path = Path("app/index.html")
index = index_path.read_text()

index = replace_once(
    index,
    '''        <button id="adminButton" class="account-button primary" type="button" hidden>ADMIN</button>\n        <button id="deleteAccountButton" class="account-button danger" type="button" hidden>DELETE ACCOUNT</button>''',
    '''        <button id="adminButton" class="account-button primary" type="button" hidden>ADMIN</button>\n        <button id="securityButton" class="account-button" type="button" hidden>SECURITY</button>\n        <button id="deleteAccountButton" class="account-button danger" type="button" hidden>DELETE ACCOUNT</button>''',
    "security button",
)

security_modal = r'''

  <div id="securityModal" class="auth-modal" hidden>
    <section class="auth-card" role="dialog" aria-modal="true" aria-labelledby="securityTitle">
      <div class="auth-card-head">
        <div>
          <h2 id="securityTitle">Account Security</h2>
          <p>Manage your password and signed-in devices.</p>
        </div>
        <button id="securityCloseButton" class="auth-close" type="button" aria-label="Close">×</button>
      </div>

      <div class="auth-body">
        <div id="securityFeedback" class="auth-feedback" role="status" aria-live="polite"></div>
        <div class="delete-account-warning" style="border-color: rgba(107,193,255,.25); background: rgba(32,88,140,.16); color:#d9efff;">
          Active sessions: <strong id="activeSessionCount">—</strong>
          <span id="currentSessionExpiry"></span>
        </div>

        <form id="passwordChangeForm" class="auth-form" autocomplete="off">
          <div class="auth-field">
            <label for="currentPasswordForChange">Current password</label>
            <input id="currentPasswordForChange" type="password" autocomplete="current-password" maxlength="200" required />
          </div>
          <div class="auth-field">
            <label for="newPassword">New password</label>
            <input id="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="200" required />
          </div>
          <div class="auth-field">
            <label for="newPasswordConfirm">Confirm new password</label>
            <input id="newPasswordConfirm" type="password" autocomplete="new-password" minlength="12" maxlength="200" required />
          </div>
          <button id="passwordChangeSubmit" class="auth-submit" type="submit">CHANGE PASSWORD</button>
        </form>

        <div style="height:1px;background:rgba(255,255,255,.08);margin:18px 0;"></div>

        <form id="revokeSessionsForm" class="auth-form" autocomplete="off">
          <div class="auth-field">
            <label for="revokeSessionsPassword">Current password</label>
            <input id="revokeSessionsPassword" type="password" autocomplete="current-password" maxlength="200" required />
            <div class="auth-help">This keeps this device signed in and logs out every other device.</div>
          </div>
          <button id="revokeSessionsSubmit" class="auth-submit secondary" type="submit">LOG OUT OTHER DEVICES</button>
        </form>
      </div>
    </section>
  </div>
'''
index = replace_once(
    index,
    '''  <div id="deleteAccountModal" class="auth-modal" hidden>''',
    security_modal + '\n  <div id="deleteAccountModal" class="auth-modal" hidden>',
    "security modal markup",
)

index = replace_once(
    index,
    '''    const adminButton = document.getElementById("adminButton");\n    const createAccountButton = document.getElementById("createAccountButton");''',
    '''    const adminButton = document.getElementById("adminButton");\n    const securityButton = document.getElementById("securityButton");\n    const createAccountButton = document.getElementById("createAccountButton");''',
    "security button ref",
)

index = replace_once(
    index,
    '''    const deleteAccountModal = document.getElementById("deleteAccountModal");''',
    '''    const securityModal = document.getElementById("securityModal");\n    const securityCloseButton = document.getElementById("securityCloseButton");\n    const securityFeedback = document.getElementById("securityFeedback");\n    const activeSessionCount = document.getElementById("activeSessionCount");\n    const currentSessionExpiry = document.getElementById("currentSessionExpiry");\n    const passwordChangeForm = document.getElementById("passwordChangeForm");\n    const currentPasswordForChange = document.getElementById("currentPasswordForChange");\n    const newPassword = document.getElementById("newPassword");\n    const newPasswordConfirm = document.getElementById("newPasswordConfirm");\n    const passwordChangeSubmit = document.getElementById("passwordChangeSubmit");\n    const revokeSessionsForm = document.getElementById("revokeSessionsForm");\n    const revokeSessionsPassword = document.getElementById("revokeSessionsPassword");\n    const revokeSessionsSubmit = document.getElementById("revokeSessionsSubmit");\n    const deleteAccountModal = document.getElementById("deleteAccountModal");''',
    "security DOM refs",
)

index = replace_once(
    index,
    '''        adminButton.hidden = currentUser.role !== "admin";\n        deleteAccountButton.hidden = currentUser.role === "admin";''',
    '''        adminButton.hidden = currentUser.role !== "admin";\n        securityButton.hidden = false;\n        deleteAccountButton.hidden = currentUser.role === "admin";''',
    "security signed-in state",
)
index = replace_once(
    index,
    '''      adminButton.hidden = true;\n      deleteAccountButton.hidden = true;''',
    '''      adminButton.hidden = true;\n      securityButton.hidden = true;\n      deleteAccountButton.hidden = true;''',
    "security signed-out state",
)

security_functions = r'''

    function clearSecurityFeedback() {
      securityFeedback.className = "auth-feedback";
      securityFeedback.textContent = "";
    }

    function showSecurityFeedback(message, type = "error") {
      securityFeedback.className = `auth-feedback visible ${type}`;
      securityFeedback.textContent = message;
    }

    async function refreshSecurityStatus() {
      const response = await fetch("/api/account/security", {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || "Could not load security status.");
      }

      activeSessionCount.textContent = String(data.activeSessions ?? 0);
      if (data.currentSessionExpiresAt) {
        const date = new Date(data.currentSessionExpiresAt);
        currentSessionExpiry.textContent = Number.isNaN(date.getTime())
          ? ""
          : ` • current session expires ${date.toLocaleString()}`;
      } else {
        currentSessionExpiry.textContent = "";
      }
    }

    async function openSecurity() {
      if (!currentUser) return;
      passwordChangeForm.reset();
      revokeSessionsForm.reset();
      clearSecurityFeedback();
      securityModal.hidden = false;
      document.body.classList.add("modal-open");
      try {
        await refreshSecurityStatus();
      } catch (error) {
        showSecurityFeedback(error.message || "Could not load security status.");
      }
    }

    function closeSecurity() {
      if (passwordChangeSubmit.disabled || revokeSessionsSubmit.disabled) return;
      securityModal.hidden = true;
      passwordChangeForm.reset();
      revokeSessionsForm.reset();
      clearSecurityFeedback();
      if (authModal.hidden && historyModal.hidden && deleteAccountModal.hidden) {
        document.body.classList.remove("modal-open");
      }
    }

    async function handlePasswordChange(event) {
      event.preventDefault();
      clearSecurityFeedback();

      const currentPassword = currentPasswordForChange.value;
      const nextPassword = newPassword.value;
      const confirmPassword = newPasswordConfirm.value;

      if (nextPassword.length < 12) {
        showSecurityFeedback("New password must be at least 12 characters.");
        return;
      }
      if (nextPassword !== confirmPassword) {
        showSecurityFeedback("The new passwords do not match.");
        return;
      }

      passwordChangeSubmit.disabled = true;
      passwordChangeSubmit.textContent = "CHANGING...";
      try {
        const response = await fetch("/api/account/password", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword,
            newPassword: nextPassword,
            newPasswordConfirm: confirmPassword
          })
        });
        const data = await readJson(response);
        if (!response.ok || data.passwordChanged !== true) {
          throw new Error(data.error || "Password change failed.");
        }

        passwordChangeForm.reset();
        showSecurityFeedback(
          `Password changed. ${Number(data.otherSessionsRevoked || 0)} other session(s) were revoked.`,
          "success"
        );
        await refreshSecurityStatus();
      } catch (error) {
        showSecurityFeedback(error.message || "Password change failed.");
      } finally {
        passwordChangeSubmit.disabled = false;
        passwordChangeSubmit.textContent = "CHANGE PASSWORD";
      }
    }

    async function handleRevokeSessions(event) {
      event.preventDefault();
      clearSecurityFeedback();
      const password = revokeSessionsPassword.value;
      if (!password) {
        showSecurityFeedback("Enter your current password.");
        return;
      }

      revokeSessionsSubmit.disabled = true;
      revokeSessionsSubmit.textContent = "REVOKING...";
      try {
        const response = await fetch("/api/account/sessions/revoke-others", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });
        const data = await readJson(response);
        if (!response.ok) {
          throw new Error(data.error || "Could not log out other devices.");
        }

        revokeSessionsForm.reset();
        showSecurityFeedback(
          `${Number(data.revokedSessions || 0)} other session(s) logged out.`,
          "success"
        );
        await refreshSecurityStatus();
      } catch (error) {
        showSecurityFeedback(error.message || "Could not log out other devices.");
      } finally {
        revokeSessionsSubmit.disabled = false;
        revokeSessionsSubmit.textContent = "LOG OUT OTHER DEVICES";
      }
    }
'''
index = replace_once(
    index,
    '''    function clearDeleteAccountFeedback() {''',
    security_functions + '\n    function clearDeleteAccountFeedback() {',
    "security functions",
)

index = replace_once(
    index,
    '''    createAccountButton.addEventListener("click", () => openAuth("register"));\n    deleteAccountButton.addEventListener("click", openDeleteAccount);''',
    '''    createAccountButton.addEventListener("click", () => openAuth("register"));\n    securityButton.addEventListener("click", openSecurity);\n    securityCloseButton.addEventListener("click", closeSecurity);\n    passwordChangeForm.addEventListener("submit", handlePasswordChange);\n    revokeSessionsForm.addEventListener("submit", handleRevokeSessions);\n    deleteAccountButton.addEventListener("click", openDeleteAccount);''',
    "security event listeners",
)

index = replace_once(
    index,
    '''    deleteAccountModal.addEventListener("click", (event) => {''',
    '''    securityModal.addEventListener("click", (event) => {\n      if (event.target === securityModal) {\n        closeSecurity();\n      }\n    });\n\n    deleteAccountModal.addEventListener("click", (event) => {''',
    "security backdrop",
)

index = replace_once(
    index,
    '''      if (!deleteAccountModal.hidden) {\n        closeDeleteAccount();\n        return;\n      }''',
    '''      if (!securityModal.hidden) {\n        closeSecurity();\n        return;\n      }\n      if (!deleteAccountModal.hidden) {\n        closeDeleteAccount();\n        return;\n      }''',
    "security escape handler",
)

index_path.write_text(index)
print("Applied account password and session security controls.")
