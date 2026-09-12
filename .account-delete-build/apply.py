from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# ----------------------------- SERVER ---------------------------------
server_path = Path("app/server.js")
server = server_path.read_text()

account_delete_route = r'''

app.delete(
  "/api/account",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    const confirmation =
      typeof req.body.confirmation === "string"
        ? req.body.confirmation.trim()
        : "";

    if (confirmation !== "DELETE") {
      return res.status(400).json({
        error: 'Type DELETE exactly to confirm permanent account deletion.'
      });
    }

    if (!password || password.length > 200) {
      return res.status(400).json({
        error: "Enter your current password to delete your account."
      });
    }

    const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);
    if (ownerEmail && normalizeEmail(req.user.email) === ownerEmail) {
      return res.status(403).json({
        error:
          "The platform owner account cannot be deleted from the public account-deletion flow."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const lockedUserResult = await client.query(
        `SELECT id, email, password_hash
         FROM users
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [req.user.id]
      );
      const lockedUser = lockedUserResult.rows[0];

      if (!lockedUser) {
        await client.query("ROLLBACK");
        clearSessionCookie(res);
        return res.status(404).json({ error: "Account not found." });
      }

      const passwordMatches = await verifyPassword(
        password,
        lockedUser.password_hash
      );

      if (!passwordMatches) {
        await client.query("ROLLBACK");
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      // Audit records are intentionally retained for platform integrity, but
      // identifying account email fields are scrubbed before the user row is
      // deleted. Foreign-key user IDs become NULL through ON DELETE SET NULL.
      await client.query(
        `UPDATE admin_audit_log
         SET target_email = NULL
         WHERE target_user_id = $1`,
        [lockedUser.id]
      );
      await client.query(
        `UPDATE admin_audit_log
         SET admin_email = 'deleted-account'
         WHERE admin_user_id = $1`,
        [lockedUser.id]
      );

      const deleted = await client.query(
        `DELETE FROM users
         WHERE id = $1
         RETURNING id`,
        [lockedUser.id]
      );

      if (!deleted.rows[0]) {
        throw new Error("Account deletion did not remove the user record.");
      }

      await client.query("COMMIT");
      clearSessionCookie(res);

      return res.json({
        ok: true,
        deleted: true
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("UNBOUND AI ACCOUNT DELETE ROLLBACK ERROR:", rollbackError);
      }

      console.error("UNBOUND AI ACCOUNT DELETE ERROR:", error);
      return res.status(500).json({
        error: "Could not delete the account. No partial deletion was accepted."
      });
    } finally {
      client.release();
    }
  }
);
'''

marker = '''app.get(\n  "/api/account/access",\n  requireDatabase,\n  requireSignedIn,'''
if marker not in server:
    raise SystemExit("account access route marker not found")

insert_before = '''/* ------------------------- CONVERSATION HISTORY ------------------------ */'''
server = replace_once(
    server,
    insert_before,
    account_delete_route + "\n" + insert_before,
    "account deletion route insertion",
)
server_path.write_text(server)


# ------------------------------ INDEX ---------------------------------
index_path = Path("app/index.html")
index = index_path.read_text()

index = replace_once(
    index,
    '''    .account-button.primary {\n      border-color: rgba(255, 173, 67, 0.45);\n      background: linear-gradient(135deg, rgba(255, 173, 67, 0.22), rgba(66, 165, 255, 0.16));\n      color: #fff3df;\n    }''',
    '''    .account-button.primary {\n      border-color: rgba(255, 173, 67, 0.45);\n      background: linear-gradient(135deg, rgba(255, 173, 67, 0.22), rgba(66, 165, 255, 0.16));\n      color: #fff3df;\n    }\n\n    .account-button.danger {\n      border-color: rgba(255, 118, 118, 0.34);\n      background: rgba(120, 24, 32, 0.22);\n      color: #ffd4d4;\n    }\n\n    .account-button.danger:hover {\n      border-color: rgba(255, 118, 118, 0.62);\n      background: rgba(142, 28, 38, 0.36);\n    }''',
    "danger topbar CSS",
)

index = replace_once(
    index,
    '''    .history-empty {\n      padding: 24px 12px;\n      color: var(--muted);\n      text-align: center;\n      line-height: 1.5;\n    }''',
    '''    .history-empty {\n      padding: 24px 12px;\n      color: var(--muted);\n      text-align: center;\n      line-height: 1.5;\n    }\n\n    .delete-account-warning {\n      margin: 0 0 16px;\n      padding: 13px 14px;\n      border: 1px solid rgba(255, 118, 118, 0.30);\n      border-radius: 12px;\n      background: rgba(105, 18, 27, 0.24);\n      color: #ffd7d7;\n      font-size: 12px;\n      line-height: 1.55;\n    }\n\n    .delete-account-warning strong {\n      color: #ffffff;\n    }\n\n    .delete-account-actions {\n      display: grid;\n      grid-template-columns: 1fr 1fr;\n      gap: 9px;\n      margin-top: 5px;\n    }\n\n    .auth-submit.danger {\n      border-color: rgba(255, 118, 118, 0.46);\n      background: linear-gradient(135deg, rgba(159, 35, 47, 0.86), rgba(100, 20, 29, 0.92));\n      color: #ffffff;\n    }\n\n    .auth-submit.secondary {\n      border-color: rgba(107, 193, 255, 0.24);\n      background: rgba(66, 165, 255, 0.08);\n      color: #d9efff;\n    }''',
    "delete modal CSS",
)

index = replace_once(
    index,
    '''        <button id="adminButton" class="account-button primary" type="button" hidden>ADMIN</button>\n        <button id="logoutButton" class="logout-button" type="button">LOG OUT</button>''',
    '''        <button id="adminButton" class="account-button primary" type="button" hidden>ADMIN</button>\n        <button id="deleteAccountButton" class="account-button danger" type="button" hidden>DELETE ACCOUNT</button>\n        <button id="logoutButton" class="logout-button" type="button">LOG OUT</button>''',
    "delete account topbar button",
)

modal_markup = r'''

  <div id="deleteAccountModal" class="auth-modal" hidden>
    <section class="auth-card" role="dialog" aria-modal="true" aria-labelledby="deleteAccountTitle">
      <div class="auth-card-head">
        <div>
          <h2 id="deleteAccountTitle">Delete UNBOUND AI Account</h2>
          <p>This is permanent and cannot be undone.</p>
        </div>
        <button id="deleteAccountCloseButton" class="auth-close" type="button" aria-label="Close">×</button>
      </div>

      <div class="auth-body">
        <div class="delete-account-warning">
          <strong>This permanently deletes your account and saved conversations.</strong>
          Active sessions, subscription records, entitlement overrides, and complimentary grants tied to the account are removed. Retained operational usage/audit records are detached from your user ID and identifying audit email fields are scrubbed.
        </div>

        <div id="deleteAccountFeedback" class="auth-feedback" role="status" aria-live="polite"></div>

        <form id="deleteAccountForm" class="auth-form" autocomplete="off">
          <div class="auth-field">
            <label for="deleteAccountPassword">Current password</label>
            <input id="deleteAccountPassword" name="password" type="password" autocomplete="current-password" maxlength="200" required />
          </div>

          <div class="auth-field">
            <label for="deleteAccountConfirmation">Type DELETE to confirm</label>
            <input id="deleteAccountConfirmation" name="confirmation" type="text" autocomplete="off" maxlength="20" placeholder="DELETE" required />
          </div>

          <div class="delete-account-actions">
            <button id="deleteAccountCancelButton" class="auth-submit secondary" type="button">CANCEL</button>
            <button id="deleteAccountSubmitButton" class="auth-submit danger" type="submit">DELETE FOREVER</button>
          </div>
        </form>
      </div>
    </section>
  </div>
'''
index = replace_once(
    index,
    '''  <div id="toast" class="toast" role="status" aria-live="polite"></div>''',
    modal_markup + '\n  <div id="toast" class="toast" role="status" aria-live="polite"></div>',
    "delete modal markup",
)

index = replace_once(
    index,
    '''    const createAccountButton = document.getElementById("createAccountButton");\n    const logoutButton = document.getElementById("logoutButton");''',
    '''    const createAccountButton = document.getElementById("createAccountButton");\n    const deleteAccountButton = document.getElementById("deleteAccountButton");\n    const logoutButton = document.getElementById("logoutButton");''',
    "delete button DOM ref",
)

index = replace_once(
    index,
    '''    const authFeedback = document.getElementById("authFeedback");\n    const toast = document.getElementById("toast");''',
    '''    const authFeedback = document.getElementById("authFeedback");\n    const deleteAccountModal = document.getElementById("deleteAccountModal");\n    const deleteAccountCloseButton = document.getElementById("deleteAccountCloseButton");\n    const deleteAccountCancelButton = document.getElementById("deleteAccountCancelButton");\n    const deleteAccountForm = document.getElementById("deleteAccountForm");\n    const deleteAccountPassword = document.getElementById("deleteAccountPassword");\n    const deleteAccountConfirmation = document.getElementById("deleteAccountConfirmation");\n    const deleteAccountSubmitButton = document.getElementById("deleteAccountSubmitButton");\n    const deleteAccountFeedback = document.getElementById("deleteAccountFeedback");\n    const toast = document.getElementById("toast");''',
    "delete modal DOM refs",
)

index = replace_once(
    index,
    '''        adminButton.hidden = currentUser.role !== "admin";\n        historyButton.hidden = false;''',
    '''        adminButton.hidden = currentUser.role !== "admin";\n        deleteAccountButton.hidden = currentUser.role === "admin";\n        historyButton.hidden = false;''',
    "signed-in delete UI state",
)
index = replace_once(
    index,
    '''      adminButton.hidden = true;\n      historyButton.hidden = true;''',
    '''      adminButton.hidden = true;\n      deleteAccountButton.hidden = true;\n      historyButton.hidden = true;''',
    "signed-out delete UI state",
)

functions = r'''

    function clearDeleteAccountFeedback() {
      deleteAccountFeedback.className = "auth-feedback";
      deleteAccountFeedback.textContent = "";
    }

    function showDeleteAccountFeedback(message, type = "error") {
      deleteAccountFeedback.className = `auth-feedback visible ${type}`;
      deleteAccountFeedback.textContent = message;
    }

    function openDeleteAccount() {
      if (!currentUser || currentUser.role === "admin") {
        showToast("Account deletion is not available for this account here.");
        return;
      }

      deleteAccountForm.reset();
      clearDeleteAccountFeedback();
      deleteAccountModal.hidden = false;
      document.body.classList.add("modal-open");
      window.setTimeout(() => deleteAccountPassword.focus(), 0);
    }

    function closeDeleteAccount() {
      if (deleteAccountSubmitButton.disabled) return;
      deleteAccountModal.hidden = true;
      deleteAccountForm.reset();
      clearDeleteAccountFeedback();
      if (authModal.hidden && historyModal.hidden) {
        document.body.classList.remove("modal-open");
      }
    }

    function setDeleteAccountBusy(isBusy) {
      deleteAccountSubmitButton.disabled = isBusy;
      deleteAccountCancelButton.disabled = isBusy;
      deleteAccountCloseButton.disabled = isBusy;
      deleteAccountSubmitButton.textContent = isBusy
        ? "DELETING..."
        : "DELETE FOREVER";
    }

    async function handleDeleteAccount(event) {
      event.preventDefault();
      clearDeleteAccountFeedback();

      if (!currentUser) {
        closeDeleteAccount();
        return;
      }

      const password = deleteAccountPassword.value;
      const confirmation = deleteAccountConfirmation.value.trim();

      if (!password) {
        showDeleteAccountFeedback("Enter your current password.");
        return;
      }

      if (confirmation !== "DELETE") {
        showDeleteAccountFeedback("Type DELETE exactly to confirm.");
        return;
      }

      const deletedUserId = String(currentUser.id || "");
      setDeleteAccountBusy(true);

      try {
        const response = await fetch("/api/account", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, confirmation })
        });
        const data = await readJson(response);

        if (!response.ok || data.deleted !== true) {
          throw new Error(data.error || "Account deletion failed.");
        }

        if (deletedUserId) {
          localStorage.removeItem(`${STORAGE_KEY_BASE}-user-${deletedUserId}`);
          localStorage.removeItem(`${DEPTH_STYLE_KEY_BASE}-user-${deletedUserId}`);
          localStorage.removeItem(`${PRODUCT_MODE_KEY_BASE}-user-${deletedUserId}`);
        }

        deleteAccountModal.hidden = true;
        deleteAccountForm.reset();
        currentUser = null;
        activeConversationId = null;
        conversationHistory = [];
        document.body.classList.remove("modal-open");
        renderAccountUi();
        await switchConversationScope();
        showToast("Your UNBOUND AI account was permanently deleted.");
      } catch (error) {
        showDeleteAccountFeedback(error.message || "Account deletion failed.");
      } finally {
        setDeleteAccountBusy(false);
      }
    }
'''
index = replace_once(
    index,
    '''    async function handleLogout() {''',
    functions + '\n    async function handleLogout() {',
    "delete account functions",
)

index = replace_once(
    index,
    '''    createAccountButton.addEventListener("click", () => openAuth("register"));\n    logoutButton.addEventListener("click", handleLogout);''',
    '''    createAccountButton.addEventListener("click", () => openAuth("register"));\n    deleteAccountButton.addEventListener("click", openDeleteAccount);\n    deleteAccountCloseButton.addEventListener("click", closeDeleteAccount);\n    deleteAccountCancelButton.addEventListener("click", closeDeleteAccount);\n    deleteAccountForm.addEventListener("submit", handleDeleteAccount);\n    logoutButton.addEventListener("click", handleLogout);''',
    "delete event listeners",
)

index = replace_once(
    index,
    '''    historyModal.addEventListener("click", (event) => {\n      if (event.target === historyModal) {\n        closeHistory();\n      }\n    });''',
    '''    historyModal.addEventListener("click", (event) => {\n      if (event.target === historyModal) {\n        closeHistory();\n      }\n    });\n\n    deleteAccountModal.addEventListener("click", (event) => {\n      if (event.target === deleteAccountModal) {\n        closeDeleteAccount();\n      }\n    });''',
    "delete backdrop listener",
)

index = replace_once(
    index,
    '''      if (!historyModal.hidden) {\n        closeHistory();\n        return;\n      }\n      if (!authModal.hidden) {''',
    '''      if (!deleteAccountModal.hidden) {\n        closeDeleteAccount();\n        return;\n      }\n      if (!historyModal.hidden) {\n        closeHistory();\n        return;\n      }\n      if (!authModal.hidden) {''',
    "delete escape handling",
)

index_path.write_text(index)
print("Applied secure account deletion backend and UI.")
