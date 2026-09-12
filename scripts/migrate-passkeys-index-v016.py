from pathlib import Path

path = Path('app/index.html')
text = path.read_text()

def one(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

one(
'''    .device-list { display: grid; gap: 8px; margin-bottom: 15px; }
''',
'''    .passkey-login {
      min-height: 44px;
      border: 1px solid rgba(255, 173, 67, 0.46);
      border-radius: 12px;
      background: rgba(255, 173, 67, 0.09);
      color: #fff0d9;
      cursor: pointer;
      font-weight: 900;
      letter-spacing: 0.03em;
    }
    .passkey-login:disabled { cursor: wait; opacity: .58; }
    .passkey-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #718399;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .passkey-divider::before, .passkey-divider::after {
      content: "";
      height: 1px;
      flex: 1;
      background: rgba(255,255,255,.09);
    }
    .passkey-list { display: grid; gap: 8px; margin: 10px 0 14px; }
    .passkey-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      padding: 10px 11px;
      border: 1px solid rgba(255,173,67,.20);
      border-radius: 11px;
      background: rgba(255,173,67,.045);
    }
    .passkey-name { color: #fff4e3; font-size: 12px; font-weight: 850; }
    .passkey-meta { margin-top: 3px; color: var(--muted); font-size: 10px; line-height: 1.4; }
    .passkey-remove {
      padding: 7px 9px;
      border: 1px solid rgba(255,118,118,.28);
      border-radius: 9px;
      background: rgba(98,21,28,.28);
      color: #ffd0d0;
      cursor: pointer;
      font-size: 10px;
      font-weight: 800;
    }

    .device-list { display: grid; gap: 8px; margin-bottom: 15px; }
''',
'passkey styles'
)

one(
'''          <button id="loginSubmit" class="auth-submit" type="submit">SIGN IN</button>
        </form>
''',
'''          <button id="loginSubmit" class="auth-submit" type="submit">SIGN IN</button>
          <div class="passkey-divider"><span>or</span></div>
          <button id="passkeyLoginButton" class="passkey-login" type="button">SIGN IN WITH PASSKEY</button>
          <div class="auth-help">A passkey can use your device's fingerprint, face, PIN, security key, or another user-verifying authenticator. UNBOUND AI never receives biometric data.</div>
        </form>
''',
'passkey login button'
)

one(
'''          <p>Manage your password and signed-in devices.</p>
''',
'''          <p>Manage your password, passkeys, and signed-in devices.</p>
''',
'security description'
)

one(
'''        <div class="access-section-title">Registered devices</div>
''',
'''        <div class="access-section-title">Passkeys</div>
        <div class="auth-help">Passkeys use public-key cryptography. Fingerprints, face scans, PINs, and private keys stay with your device or credential provider and are never stored by UNBOUND AI.</div>
        <div class="auth-field" style="margin-top:10px;">
          <label for="passkeyLabel">Passkey name (optional)</label>
          <input id="passkeyLabel" type="text" maxlength="80" autocomplete="off" placeholder="Example: Laptop passkey" />
        </div>
        <button id="addPasskeyButton" class="auth-submit" type="button" style="margin-top:10px;">ADD PASSKEY</button>
        <div id="passkeyList" class="passkey-list"><div class="history-empty">Loading passkeys…</div></div>
        <div class="auth-field" style="margin-bottom:16px;">
          <label for="passkeyRemovePassword">Current password for passkey removal</label>
          <input id="passkeyRemovePassword" type="password" autocomplete="current-password" maxlength="200" />
          <div class="auth-help">Adding a passkey uses device verification. Removing a passkey requires your current UNBOUND AI password.</div>
        </div>

        <div class="access-section-title">Registered devices</div>
''',
'passkey security section'
)

one(
'''    const authFeedback = document.getElementById("authFeedback");
    const securityModal = document.getElementById("securityModal");
''',
'''    const authFeedback = document.getElementById("authFeedback");
    const passkeyLoginButton = document.getElementById("passkeyLoginButton");
    const securityModal = document.getElementById("securityModal");
''',
'passkey login element'
)

one(
'''    const securityEventList = document.getElementById("securityEventList");
    const passwordChangeForm = document.getElementById("passwordChangeForm");
''',
'''    const securityEventList = document.getElementById("securityEventList");
    const addPasskeyButton = document.getElementById("addPasskeyButton");
    const passkeyLabel = document.getElementById("passkeyLabel");
    const passkeyList = document.getElementById("passkeyList");
    const passkeyRemovePassword = document.getElementById("passkeyRemovePassword");
    const passwordChangeForm = document.getElementById("passwordChangeForm");
''',
'passkey security elements'
)

one(
'''    let securityDevices = [];
    let securityEvents = [];
''',
'''    let securityDevices = [];
    let securityEvents = [];
    let accountPasskeys = [];
''',
'passkey state'
)

one(
'''    function setAuthBusy(isBusy) {
      loginSubmit.disabled = isBusy;
      registerSubmit.disabled = isBusy;
      loginSubmit.textContent = isBusy ? "PLEASE WAIT..." : "SIGN IN";
      registerSubmit.textContent = isBusy ? "PLEASE WAIT..." : "CREATE ACCOUNT";
    }
''',
'''    function setAuthBusy(isBusy) {
      loginSubmit.disabled = isBusy;
      registerSubmit.disabled = isBusy;
      passkeyLoginButton.disabled = isBusy;
      loginSubmit.textContent = isBusy ? "PLEASE WAIT..." : "SIGN IN";
      registerSubmit.textContent = isBusy ? "PLEASE WAIT..." : "CREATE ACCOUNT";
      passkeyLoginButton.textContent = isBusy ? "PLEASE WAIT..." : "SIGN IN WITH PASSKEY";
    }
''',
'passkey auth busy state'
)

function_block = r'''
    function passkeysSupported() {
      return Boolean(window.PublicKeyCredential && navigator.credentials);
    }

    function base64urlToBytes(value) {
      const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
      const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }

    function bytesToBase64url(value) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
      }
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }

    function browserRegistrationOptions(options) {
      return {
        ...options,
        challenge: base64urlToBytes(options.challenge),
        user: {
          ...options.user,
          id: base64urlToBytes(options.user.id)
        },
        excludeCredentials: (options.excludeCredentials || []).map((item) => ({
          ...item,
          id: base64urlToBytes(item.id)
        }))
      };
    }

    function browserAuthenticationOptions(options) {
      return {
        ...options,
        challenge: base64urlToBytes(options.challenge),
        allowCredentials: (options.allowCredentials || []).map((item) => ({
          ...item,
          id: base64urlToBytes(item.id)
        }))
      };
    }

    function registrationCredentialJson(credential) {
      const response = credential.response;
      const result = {
        id: credential.id,
        rawId: bytesToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bytesToBase64url(response.clientDataJSON),
          attestationObject: bytesToBase64url(response.attestationObject),
          transports: typeof response.getTransports === "function" ? response.getTransports() : []
        },
        clientExtensionResults: credential.getClientExtensionResults?.() || {},
        authenticatorAttachment: credential.authenticatorAttachment || null
      };
      if (typeof response.getPublicKeyAlgorithm === "function") {
        result.response.publicKeyAlgorithm = response.getPublicKeyAlgorithm();
      }
      if (typeof response.getPublicKey === "function") {
        const publicKey = response.getPublicKey();
        if (publicKey) result.response.publicKey = bytesToBase64url(publicKey);
      }
      return result;
    }

    function authenticationCredentialJson(credential) {
      const response = credential.response;
      return {
        id: credential.id,
        rawId: bytesToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bytesToBase64url(response.clientDataJSON),
          authenticatorData: bytesToBase64url(response.authenticatorData),
          signature: bytesToBase64url(response.signature),
          userHandle: response.userHandle ? bytesToBase64url(response.userHandle) : null
        },
        clientExtensionResults: credential.getClientExtensionResults?.() || {},
        authenticatorAttachment: credential.authenticatorAttachment || null
      };
    }

    async function handlePasskeyLogin() {
      clearAuthFeedback();
      if (!passkeysSupported()) {
        showAuthFeedback("This browser or device does not support WebAuthn passkeys.");
        return;
      }
      setAuthBusy(true);
      try {
        const optionsResponse = await fetch("/api/auth/passkey/options", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
        const optionsData = await readJson(optionsResponse);
        if (!optionsResponse.ok) throw new Error(optionsData.error || "Could not start passkey sign-in.");

        const credential = await navigator.credentials.get({
          publicKey: browserAuthenticationOptions(optionsData.options)
        });
        if (!credential) throw new Error("No passkey was returned by the device.");

        const verifyResponse = await fetch("/api/auth/passkey/verify", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: authenticationCredentialJson(credential) })
        });
        const data = await readJson(verifyResponse);
        if (!verifyResponse.ok) throw new Error(data.error || "Passkey sign-in failed.");

        currentUser = data.user || null;
        await refreshAccountAccess({ silent: true });
        closeAuth();
        await switchConversationScope();
        showToast(`Signed in with a passkey as ${currentUser?.displayName || currentUser?.email || "UNBOUND User"}.`);
      } catch (error) {
        if (error?.name === "NotAllowedError") {
          showAuthFeedback("Passkey sign-in was cancelled or timed out.");
        } else {
          showAuthFeedback(error.message || "Passkey sign-in failed.");
        }
      } finally {
        setAuthBusy(false);
      }
    }

    function renderPasskeys() {
      passkeyList.innerHTML = "";
      if (!accountPasskeys.length) {
        passkeyList.innerHTML = '<div class="history-empty">No passkeys registered yet.</div>';
        return;
      }
      for (const passkey of accountPasskeys) {
        const row = document.createElement("div");
        row.className = "passkey-row";
        const copy = document.createElement("div");
        const name = document.createElement("div");
        name.className = "passkey-name";
        name.textContent = passkey.label || "Passkey";
        const meta = document.createElement("div");
        meta.className = "passkey-meta";
        const created = passkey.createdAt ? new Date(passkey.createdAt) : null;
        const lastUsed = passkey.lastUsedAt ? new Date(passkey.lastUsedAt) : null;
        const parts = [];
        parts.push(passkey.backedUp ? "synced/backed up" : "device credential");
        if (passkey.deviceType) parts.push(String(passkey.deviceType));
        if (created && !Number.isNaN(created.getTime())) parts.push(`added ${created.toLocaleDateString()}`);
        if (lastUsed && !Number.isNaN(lastUsed.getTime())) parts.push(`used ${lastUsed.toLocaleString()}`);
        meta.textContent = parts.join(" • ");
        copy.append(name, meta);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "passkey-remove";
        remove.textContent = "REMOVE";
        remove.addEventListener("click", async () => {
          const password = passkeyRemovePassword.value;
          if (!password) {
            showSecurityFeedback("Enter your current password before removing a passkey.");
            passkeyRemovePassword.focus();
            return;
          }
          if (!window.confirm(`Remove ${passkey.label || "this passkey"}?`)) return;
          remove.disabled = true;
          try {
            const response = await fetch(`/api/account/passkeys/${encodeURIComponent(passkey.id)}`, {
              method: "DELETE",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password })
            });
            const data = await readJson(response);
            if (!response.ok) throw new Error(data.error || "Could not remove that passkey.");
            passkeyRemovePassword.value = "";
            showSecurityFeedback(`${passkey.label || "Passkey"} removed.`, "success");
            await Promise.all([loadPasskeys(), loadSecurityEvents()]);
          } catch (error) {
            showSecurityFeedback(error.message || "Could not remove that passkey.");
          } finally {
            remove.disabled = false;
          }
        });
        row.append(copy, remove);
        passkeyList.appendChild(row);
      }
    }

    async function loadPasskeys() {
      const response = await fetch("/api/account/passkeys", {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not load passkeys.");
      accountPasskeys = Array.isArray(data.passkeys) ? data.passkeys : [];
      renderPasskeys();
    }

    async function handleAddPasskey() {
      clearSecurityFeedback();
      if (!passkeysSupported()) {
        showSecurityFeedback("This browser or device does not support WebAuthn passkeys.");
        return;
      }
      addPasskeyButton.disabled = true;
      addPasskeyButton.textContent = "WAITING FOR DEVICE...";
      try {
        const optionsResponse = await fetch("/api/account/passkeys/register/options", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        });
        const optionsData = await readJson(optionsResponse);
        if (!optionsResponse.ok) throw new Error(optionsData.error || "Could not start passkey registration.");

        const credential = await navigator.credentials.create({
          publicKey: browserRegistrationOptions(optionsData.options)
        });
        if (!credential) throw new Error("No passkey was returned by the device.");

        const verifyResponse = await fetch("/api/account/passkeys/register/verify", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response: registrationCredentialJson(credential),
            label: passkeyLabel.value.trim()
          })
        });
        const data = await readJson(verifyResponse);
        if (!verifyResponse.ok) throw new Error(data.error || "Passkey registration failed.");

        passkeyLabel.value = "";
        showSecurityFeedback("Passkey added. You can now sign in without typing your UNBOUND AI password.", "success");
        await Promise.all([loadPasskeys(), loadSecurityEvents()]);
      } catch (error) {
        if (error?.name === "NotAllowedError") {
          showSecurityFeedback("Passkey setup was cancelled or timed out.");
        } else {
          showSecurityFeedback(error.message || "Passkey registration failed.");
        }
      } finally {
        addPasskeyButton.disabled = false;
        addPasskeyButton.textContent = "ADD PASSKEY";
      }
    }

'''
one(
'''    function clearSecurityFeedback() {
''',
function_block + '''    function clearSecurityFeedback() {
''',
'passkey browser functions'
)

one(
'''        "sessions.all_revoked": "All sessions logged out"
''',
'''        "sessions.all_revoked": "All sessions logged out",
        "passkey.registered": "Passkey added",
        "passkey.removed": "Passkey removed",
        "passkey.signed_in": "Passkey sign-in"
''',
'passkey security event labels'
)

one(
'''      await Promise.all([loadSecurityDevices(), loadSecurityEvents()]);
''',
'''      await Promise.all([loadSecurityDevices(), loadSecurityEvents(), loadPasskeys()]);
''',
'passkey security refresh'
)

one(
'''      deviceRevokePassword.value = "";
      clearSecurityFeedback();
''',
'''      deviceRevokePassword.value = "";
      passkeyRemovePassword.value = "";
      passkeyLabel.value = "";
      clearSecurityFeedback();
''',
'passkey open security reset'
)

one(
'''      deviceRevokePassword.value = "";
      securityDevices = [];
      securityEvents = [];
''',
'''      deviceRevokePassword.value = "";
      passkeyRemovePassword.value = "";
      passkeyLabel.value = "";
      securityDevices = [];
      securityEvents = [];
      accountPasskeys = [];
''',
'passkey close security reset'
)

one(
'''    loginForm.addEventListener("submit", handleLogin);
    registerForm.addEventListener("submit", handleRegister);
''',
'''    loginForm.addEventListener("submit", handleLogin);
    passkeyLoginButton.addEventListener("click", handlePasskeyLogin);
    registerForm.addEventListener("submit", handleRegister);
    addPasskeyButton.addEventListener("click", handleAddPasskey);
''',
'passkey event handlers'
)

one(
'''    async function initializePage() {
      renderAccountUi();
      await loadCurrentUser();
''',
'''    async function initializePage() {
      passkeyLoginButton.hidden = !passkeysSupported();
      addPasskeyButton.disabled = !passkeysSupported();
      if (!passkeysSupported()) {
        addPasskeyButton.title = "This browser or device does not support WebAuthn passkeys.";
      }
      renderAccountUi();
      await loadCurrentUser();
''',
'passkey support detection'
)

path.write_text(text)
print('passkey index migration applied')
