from pathlib import Path

path = Path('app/index.html')
text = path.read_text()


def one(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)


# Three account tabs: sign in, create, recover.
one(
'''    .auth-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding: 14px 20px 0;
    }
''',
'''    .auth-tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      padding: 14px 20px 0;
    }
''',
'auth tab columns'
)

# Recovery-code presentation styles, immediately before the mobile media rules.
style_anchor = '''    @media (max-width: 820px) {
'''
style_code = '''    .recovery-code-panel {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid rgba(255, 173, 67, 0.30);
      border-radius: 12px;
      background: rgba(255, 173, 67, 0.07);
    }
    .recovery-code-warning {
      color: #ffd9aa;
      font-size: 11px;
      line-height: 1.5;
    }
    .recovery-code-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
      margin-top: 10px;
    }
    .recovery-code-item {
      padding: 8px 9px;
      border: 1px solid rgba(107, 193, 255, 0.20);
      border-radius: 9px;
      background: rgba(2, 8, 18, 0.75);
      color: #f6fbff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      user-select: all;
      word-break: break-all;
    }
    .recovery-code-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    @media (max-width: 560px) {
      .recovery-code-grid { grid-template-columns: 1fr; }
      .auth-tab { padding-left: 6px; padding-right: 6px; font-size: 10px; }
    }

'''
one(style_anchor, style_code + style_anchor, 'recovery code styles')

one(
'''        <button id="loginTab" class="auth-tab active" type="button" role="tab" aria-selected="true">SIGN IN</button>
        <button id="registerTab" class="auth-tab" type="button" role="tab" aria-selected="false">CREATE ACCOUNT</button>
''',
'''        <button id="loginTab" class="auth-tab active" type="button" role="tab" aria-selected="true">SIGN IN</button>
        <button id="registerTab" class="auth-tab" type="button" role="tab" aria-selected="false">CREATE ACCOUNT</button>
        <button id="recoveryTab" class="auth-tab" type="button" role="tab" aria-selected="false">RECOVER</button>
''',
'recovery auth tab'
)

# Add public recovery form after account registration form.
form_anchor = '''          <button id="registerSubmit" class="auth-submit" type="submit">CREATE ACCOUNT</button>
        </form>
      </div>
'''
form_insert = '''          <button id="registerSubmit" class="auth-submit" type="submit">CREATE ACCOUNT</button>
        </form>

        <form id="recoveryForm" class="auth-form" autocomplete="off" hidden>
          <div class="auth-help">Use one of the one-time recovery codes you previously saved. A successful recovery resets your password, logs out every session, revokes registered devices, and removes existing passkeys so a stolen credential cannot keep access.</div>
          <div class="auth-field">
            <label for="recoveryEmail">Email</label>
            <input id="recoveryEmail" type="email" autocomplete="email" placeholder="you@example.com" required />
          </div>
          <div class="auth-field">
            <label for="recoveryCode">Recovery code</label>
            <input id="recoveryCode" type="text" autocomplete="off" maxlength="40" placeholder="UNB-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required />
          </div>
          <div class="auth-field">
            <label for="recoveryNewPassword">New password</label>
            <input id="recoveryNewPassword" type="password" autocomplete="new-password" minlength="12" maxlength="200" required />
          </div>
          <div class="auth-field">
            <label for="recoveryNewPasswordConfirm">Confirm new password</label>
            <input id="recoveryNewPasswordConfirm" type="password" autocomplete="new-password" minlength="12" maxlength="200" required />
          </div>
          <button id="recoverySubmit" class="auth-submit" type="submit">RESET WITH RECOVERY CODE</button>
        </form>
      </div>
'''
one(form_anchor, form_insert, 'recovery form')

# Recovery-code management belongs in Account Security, after passkeys and before devices.
security_anchor = '''        <div class="access-section-title">Registered devices</div>
'''
security_insert = '''        <div class="access-section-title">Recovery codes</div>
        <div id="recoveryCodeStatus" class="auth-help">Loading recovery-code status…</div>
        <div class="auth-field" style="margin-top:10px;">
          <label for="recoveryCodesPassword">Current password</label>
          <input id="recoveryCodesPassword" type="password" autocomplete="current-password" maxlength="200" />
          <div class="auth-help">Required to create or replace your recovery codes. Replacing them immediately invalidates every older recovery code.</div>
        </div>
        <button id="recoveryCodesGenerateButton" class="auth-submit secondary" type="button" style="margin-top:10px;">GENERATE RECOVERY CODES</button>
        <div id="recoveryCodesPanel" class="recovery-code-panel" hidden>
          <div class="recovery-code-warning"><strong>Save these now.</strong> These codes are shown only once. Each code can recover the account one time; using recovery also removes existing passkeys and ends all sessions.</div>
          <div id="recoveryCodeGrid" class="recovery-code-grid"></div>
          <div class="recovery-code-actions">
            <button id="copyRecoveryCodesButton" class="account-button" type="button">COPY CODES</button>
          </div>
        </div>

        <div class="access-section-title">Registered devices</div>
'''
one(security_anchor, security_insert, 'security recovery-code section')

# DOM references.
one(
'''    const loginTab = document.getElementById("loginTab");
    const registerTab = document.getElementById("registerTab");
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const loginSubmit = document.getElementById("loginSubmit");
    const registerSubmit = document.getElementById("registerSubmit");
''',
'''    const loginTab = document.getElementById("loginTab");
    const registerTab = document.getElementById("registerTab");
    const recoveryTab = document.getElementById("recoveryTab");
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const recoveryForm = document.getElementById("recoveryForm");
    const loginSubmit = document.getElementById("loginSubmit");
    const registerSubmit = document.getElementById("registerSubmit");
    const recoverySubmit = document.getElementById("recoverySubmit");
''',
'recovery auth DOM refs'
)

one(
'''    const passkeyList = document.getElementById("passkeyList");
    const passkeyRemovePassword = document.getElementById("passkeyRemovePassword");
''',
'''    const passkeyList = document.getElementById("passkeyList");
    const passkeyRemovePassword = document.getElementById("passkeyRemovePassword");
    const recoveryCodeStatus = document.getElementById("recoveryCodeStatus");
    const recoveryCodesPassword = document.getElementById("recoveryCodesPassword");
    const recoveryCodesGenerateButton = document.getElementById("recoveryCodesGenerateButton");
    const recoveryCodesPanel = document.getElementById("recoveryCodesPanel");
    const recoveryCodeGrid = document.getElementById("recoveryCodeGrid");
    const copyRecoveryCodesButton = document.getElementById("copyRecoveryCodesButton");
''',
'recovery security DOM refs'
)

one(
'''    let securityEvents = [];
    let accountPasskeys = [];
''',
'''    let securityEvents = [];
    let accountPasskeys = [];
    let currentRecoveryCodes = [];
''',
'recovery UI state'
)

# Turn the two-mode account tab function into a three-mode function.
one(
'''      const isLogin = mode !== "register";

      loginTab.classList.toggle("active", isLogin);
      registerTab.classList.toggle("active", !isLogin);
      loginTab.setAttribute("aria-selected", isLogin ? "true" : "false");
      registerTab.setAttribute("aria-selected", isLogin ? "false" : "true");
      loginForm.hidden = !isLogin;
      registerForm.hidden = isLogin;
''',
'''      const activeMode = mode === "register" || mode === "recovery" ? mode : "login";
      const isLogin = activeMode === "login";
      const isRegister = activeMode === "register";
      const isRecovery = activeMode === "recovery";

      loginTab.classList.toggle("active", isLogin);
      registerTab.classList.toggle("active", isRegister);
      recoveryTab.classList.toggle("active", isRecovery);
      loginTab.setAttribute("aria-selected", isLogin ? "true" : "false");
      registerTab.setAttribute("aria-selected", isRegister ? "true" : "false");
      recoveryTab.setAttribute("aria-selected", isRecovery ? "true" : "false");
      loginForm.hidden = !isLogin;
      registerForm.hidden = !isRegister;
      recoveryForm.hidden = !isRecovery;
''',
'recovery auth mode state'
)

one(
'''        const target = isLogin
          ? document.getElementById("loginEmail")
          : document.getElementById("registerName");
''',
'''        const target = isLogin
          ? document.getElementById("loginEmail")
          : isRegister
            ? document.getElementById("registerName")
            : document.getElementById("recoveryEmail");
''',
'recovery auth focus'
)

one(
'''      loginSubmit.disabled = isBusy;
      registerSubmit.disabled = isBusy;
      passkeyLoginButton.disabled = isBusy;
      loginSubmit.textContent = isBusy ? "PLEASE WAIT..." : "SIGN IN";
      registerSubmit.textContent = isBusy ? "PLEASE WAIT..." : "CREATE ACCOUNT";
      passkeyLoginButton.textContent = isBusy ? "PLEASE WAIT..." : "SIGN IN WITH PASSKEY";
''',
'''      loginSubmit.disabled = isBusy;
      registerSubmit.disabled = isBusy;
      recoverySubmit.disabled = isBusy;
      passkeyLoginButton.disabled = isBusy;
      loginSubmit.textContent = isBusy ? "PLEASE WAIT..." : "SIGN IN";
      registerSubmit.textContent = isBusy ? "PLEASE WAIT..." : "CREATE ACCOUNT";
      recoverySubmit.textContent = isBusy ? "PLEASE WAIT..." : "RESET WITH RECOVERY CODE";
      passkeyLoginButton.textContent = isBusy ? "PLEASE WAIT..." : "SIGN IN WITH PASSKEY";
''',
'recovery auth busy state'
)

# Public recovery submit handler, immediately before registration handler.
register_handler_anchor = '''    async function handleRegister(event) {
'''
recovery_handler = '''    async function handleRecovery(event) {
      event.preventDefault();
      clearAuthFeedback();
      const email = document.getElementById("recoveryEmail").value.trim();
      const recoveryCode = document.getElementById("recoveryCode").value.trim();
      const newPassword = document.getElementById("recoveryNewPassword").value;
      const newPasswordConfirm = document.getElementById("recoveryNewPasswordConfirm").value;

      if (newPassword.length < 12) {
        showAuthFeedback("Your new password must be at least 12 characters.");
        return;
      }
      if (newPassword !== newPasswordConfirm) {
        showAuthFeedback("The two new passwords do not match.");
        return;
      }

      setAuthBusy(true);
      try {
        const response = await fetch("/api/auth/recovery-code/reset", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, recoveryCode, newPassword, newPasswordConfirm })
        });
        const data = await readJson(response);
        if (!response.ok || data.recovered !== true) {
          throw new Error(data.error || "Account recovery failed.");
        }

        recoveryForm.reset();
        setAuthMode("login");
        document.getElementById("loginEmail").value = email;
        showAuthFeedback(
          "Account recovered. Every previous session and registered device was revoked, existing passkeys were removed, and all recovery codes were invalidated. Sign in with your new password, then create a fresh recovery-code set and re-add passkeys.",
          "success"
        );
      } catch (error) {
        showAuthFeedback(error.message || "Account recovery failed.");
      } finally {
        setAuthBusy(false);
      }
    }

'''
one(register_handler_anchor, recovery_handler + register_handler_anchor, 'recovery submit handler')

# Recovery-code management functions before the existing passkey renderer.
passkey_renderer_anchor = '''    function renderPasskeys() {
'''
recovery_management = '''    function renderRecoveryCodeStatus(recovery) {
      const remaining = Number(recovery?.remaining || 0);
      if (remaining > 0) {
        const generated = recovery?.generatedAt ? new Date(recovery.generatedAt) : null;
        const generatedText = generated && !Number.isNaN(generated.getTime())
          ? ` • generated ${generated.toLocaleString()}`
          : "";
        recoveryCodeStatus.textContent = `${remaining} unused recovery code(s) remain${generatedText}.`;
        recoveryCodesGenerateButton.textContent = "REPLACE RECOVERY CODES";
      } else {
        recoveryCodeStatus.textContent = "No recovery codes are currently available. Generate a set and store it somewhere safe outside UNBOUND AI.";
        recoveryCodesGenerateButton.textContent = "GENERATE RECOVERY CODES";
      }
    }

    async function loadRecoveryCodeStatus() {
      const response = await fetch("/api/account/recovery-codes/status", {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not load recovery-code status.");
      renderRecoveryCodeStatus(data.recovery || null);
    }

    function showGeneratedRecoveryCodes(codes) {
      currentRecoveryCodes = Array.isArray(codes) ? codes.slice() : [];
      recoveryCodeGrid.innerHTML = "";
      for (const code of currentRecoveryCodes) {
        const item = document.createElement("div");
        item.className = "recovery-code-item";
        item.textContent = code;
        recoveryCodeGrid.appendChild(item);
      }
      recoveryCodesPanel.hidden = currentRecoveryCodes.length === 0;
    }

    async function handleGenerateRecoveryCodes() {
      clearSecurityFeedback();
      const password = recoveryCodesPassword.value;
      if (!password) {
        showSecurityFeedback("Enter your current password before generating recovery codes.");
        recoveryCodesPassword.focus();
        return;
      }
      if (!window.confirm("Generate a new recovery-code set? Any older recovery codes will stop working immediately.")) return;

      recoveryCodesGenerateButton.disabled = true;
      recoveryCodesGenerateButton.textContent = "GENERATING...";
      try {
        const response = await fetch("/api/account/recovery-codes/regenerate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });
        const data = await readJson(response);
        if (!response.ok || !Array.isArray(data.codes)) {
          throw new Error(data.error || "Could not generate recovery codes.");
        }
        recoveryCodesPassword.value = "";
        showGeneratedRecoveryCodes(data.codes);
        renderRecoveryCodeStatus(data.recovery || null);
        showSecurityFeedback("New recovery codes generated. Save them now; UNBOUND AI cannot display this same set again.", "success");
        await loadSecurityEvents();
      } catch (error) {
        showSecurityFeedback(error.message || "Could not generate recovery codes.");
      } finally {
        recoveryCodesGenerateButton.disabled = false;
        if (currentRecoveryCodes.length) {
          recoveryCodesGenerateButton.textContent = "REPLACE RECOVERY CODES";
        } else {
          await loadRecoveryCodeStatus().catch(() => {});
        }
      }
    }

    async function handleCopyRecoveryCodes() {
      if (!currentRecoveryCodes.length) return;
      try {
        await navigator.clipboard.writeText(currentRecoveryCodes.join("\\n"));
        showToast("Recovery codes copied. Store them somewhere private and separate from UNBOUND AI.");
      } catch (error) {
        showSecurityFeedback("Could not copy automatically. Select the codes and copy them manually.");
      }
    }

'''
one(passkey_renderer_anchor, recovery_management + passkey_renderer_anchor, 'recovery code management functions')

# Security feed labels/details.
one(
'''        "sessions.all_revoked": "All sessions logged out",
        "passkey.added": "Passkey added",
        "passkey.removed": "Passkey removed",
        "passkey.signed_in": "Signed in with passkey"
''',
'''        "sessions.all_revoked": "All sessions logged out",
        "passkey.added": "Passkey added",
        "passkey.removed": "Passkey removed",
        "passkey.signed_in": "Signed in with passkey",
        "recovery.codes_generated": "Recovery codes generated",
        "recovery.code_used": "Account recovered with recovery code"
''',
'recovery security event labels'
)

one(
'''      if (details.otherSessionsRevoked !== undefined) parts.push(`${Number(details.otherSessionsRevoked || 0)} other session(s)`);
''',
'''      if (details.otherSessionsRevoked !== undefined) parts.push(`${Number(details.otherSessionsRevoked || 0)} other session(s)`);
      if (details.recoveryCodesGenerated !== undefined) parts.push(`${Number(details.recoveryCodesGenerated || 0)} recovery code(s)`);
      if (details.passkeysRemoved !== undefined) parts.push(`${Number(details.passkeysRemoved || 0)} passkey(s) removed`);
      if (details.devicesRevoked !== undefined) parts.push(`${Number(details.devicesRevoked || 0)} device(s) revoked`);
''',
'recovery security event detail text'
)

one(
'''      await Promise.all([loadSecurityDevices(), loadSecurityEvents(), loadPasskeys()]);
''',
'''      await Promise.all([
        loadSecurityDevices(),
        loadSecurityEvents(),
        loadPasskeys(),
        loadRecoveryCodeStatus()
      ]);
''',
'load recovery status with security panel'
)

# Clear the one-time plaintext codes whenever the Security modal opens/closes.
one(
'''      passkeyRemovePassword.value = "";
      passkeyLabel.value = "";
      clearSecurityFeedback();
''',
'''      passkeyRemovePassword.value = "";
      passkeyLabel.value = "";
      recoveryCodesPassword.value = "";
      currentRecoveryCodes = [];
      recoveryCodeGrid.innerHTML = "";
      recoveryCodesPanel.hidden = true;
      clearSecurityFeedback();
''',
'clear recovery codes on security open'
)

one(
'''      passkeyRemovePassword.value = "";
      passkeyLabel.value = "";
      securityDevices = [];
''',
'''      passkeyRemovePassword.value = "";
      passkeyLabel.value = "";
      recoveryCodesPassword.value = "";
      currentRecoveryCodes = [];
      recoveryCodeGrid.innerHTML = "";
      recoveryCodesPanel.hidden = true;
      securityDevices = [];
''',
'clear recovery codes on security close'
)

one(
'''      if (passwordChangeSubmit.disabled || revokeSessionsSubmit.disabled || logoutAllSubmit.disabled) return;
''',
'''      if (
        passwordChangeSubmit.disabled ||
        revokeSessionsSubmit.disabled ||
        logoutAllSubmit.disabled ||
        recoveryCodesGenerateButton.disabled
      ) return;
''',
'prevent close while recovery generation is active'
)

# Event wiring.
one(
'''    loginTab.addEventListener("click", () => setAuthMode("login"));
    registerTab.addEventListener("click", () => setAuthMode("register"));
    loginForm.addEventListener("submit", handleLogin);
''',
'''    loginTab.addEventListener("click", () => setAuthMode("login"));
    registerTab.addEventListener("click", () => setAuthMode("register"));
    recoveryTab.addEventListener("click", () => setAuthMode("recovery"));
    loginForm.addEventListener("submit", handleLogin);
''',
'recovery auth event wiring'
)

one(
'''    passkeyLoginButton.addEventListener("click", handlePasskeyLogin);
    registerForm.addEventListener("submit", handleRegister);
    addPasskeyButton.addEventListener("click", handleAddPasskey);
''',
'''    passkeyLoginButton.addEventListener("click", handlePasskeyLogin);
    registerForm.addEventListener("submit", handleRegister);
    recoveryForm.addEventListener("submit", handleRecovery);
    addPasskeyButton.addEventListener("click", handleAddPasskey);
    recoveryCodesGenerateButton.addEventListener("click", handleGenerateRecoveryCodes);
    copyRecoveryCodesButton.addEventListener("click", handleCopyRecoveryCodes);
''',
'recovery form and security action wiring'
)

path.write_text(text)
print('Applied UNBOUND AI recovery-code UI migration.')
