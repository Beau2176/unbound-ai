(() => {
  "use strict";

  const ADULT_BUTTON_ID = "adultModeButton";
  const TOAST_ID = "unbound-adult-step-up-toast";
  let busy = false;
  let bypassNextClick = false;

  function passkeysSupported() {
    return Boolean(window.PublicKeyCredential && navigator.credentials?.get);
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
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

  function ensureToast() {
    let toast = document.getElementById(TOAST_ID);
    if (toast) return toast;
    const style = document.createElement("style");
    style.textContent = `
      #${TOAST_ID}{position:fixed;left:50%;bottom:24px;z-index:100010;max-width:min(520px,calc(100% - 28px));transform:translate(-50%,18px);opacity:0;pointer-events:none;padding:12px 15px;border:1px solid rgba(107,193,255,.5);border-radius:13px;background:rgba(3,9,18,.97);color:#f7fbff;box-shadow:0 18px 52px rgba(0,0,0,.55);font:700 13px/1.45 system-ui;transition:opacity .16s ease,transform .16s ease}
      #${TOAST_ID}[data-show="true"]{opacity:1;transform:translate(-50%,0)}
      #${TOAST_ID}[data-kind="error"]{border-color:rgba(255,118,118,.62);color:#ffd9d9}
      #${TOAST_ID}[data-kind="ok"]{border-color:rgba(101,232,164,.55);color:#c9ffe1}
    `;
    document.head.appendChild(style);
    toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
    return toast;
  }

  let toastTimer = null;
  function showToast(message, kind = "") {
    const toast = ensureToast();
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = String(message || "");
    toast.dataset.kind = kind;
    toast.dataset.show = "true";
    toastTimer = setTimeout(() => { toast.dataset.show = "false"; }, 5200);
  }

  async function readJson(response) {
    try { return await response.json(); } catch (_) { return {}; }
  }

  async function getStatus() {
    const response = await fetch("/api/account/adult-step-up/status", {
      method: "GET",
      credentials: "same-origin",
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });
    const data = await readJson(response);
    return { response, data };
  }

  async function unlockAdultMode() {
    if (!passkeysSupported()) {
      throw new Error("This browser or device does not support passkeys. Use a modern browser/device with passkey support.");
    }

    const optionsResponse = await fetch("/api/account/adult-step-up/options", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: "{}"
    });
    const optionsData = await readJson(optionsResponse);
    if (!optionsResponse.ok) {
      const error = new Error(optionsData.error || "Could not start Adult Mode device verification.");
      error.code = optionsData.code || null;
      error.passkeyRegistrationRequired = Boolean(optionsData.passkeyRegistrationRequired);
      throw error;
    }

    const credential = await navigator.credentials.get({
      publicKey: browserAuthenticationOptions(optionsData.options)
    });
    if (!credential) throw new Error("No passkey was returned by the device.");

    const verifyResponse = await fetch("/api/account/adult-step-up/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ response: authenticationCredentialJson(credential) })
    });
    const verifyData = await readJson(verifyResponse);
    if (!verifyResponse.ok || !verifyData?.adultStepUp?.verified) {
      throw new Error(verifyData.error || "This device could not be verified for Adult Mode.");
    }
    window.dispatchEvent(new CustomEvent("unbound:adult-step-up-changed", {
      detail: verifyData.adultStepUp
    }));
    return verifyData.adultStepUp;
  }

  function continueOriginalClick(button) {
    bypassNextClick = true;
    setTimeout(() => button.click(), 0);
  }

  async function interceptAdultClick(event) {
    const button = event.target?.closest?.(`#${ADULT_BUTTON_ID}`);
    if (!button) return;
    if (bypassNextClick) {
      bypassNextClick = false;
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    busy = true;
    const previousTitle = button.title;
    button.dataset.adultUnlockBusy = "true";
    button.title = "Checking Adult Mode device lock…";

    try {
      const { response, data } = await getStatus();
      if (response.status === 401) {
        continueOriginalClick(button);
        return;
      }
      if (!response.ok) throw new Error(data.error || "Could not check Adult Mode device lock.");

      if (!data?.ageVerification?.verified) {
        continueOriginalClick(button);
        return;
      }
      if (data?.adultStepUp?.verified) {
        continueOriginalClick(button);
        return;
      }
      if (Number(data?.adultStepUp?.passkeyCount || 0) < 1) {
        showToast("Adult Mode requires a passkey on this account. Open Account → Passkeys, register this device, then try Adult Mode again.", "error");
        return;
      }

      showToast("Confirm your device to unlock Adult Mode. Your fingerprint/face data stays on your device.");
      const result = await unlockAdultMode();
      const hours = Math.max(1, Math.round(Number(result.ttlMinutes || 720) / 60));
      showToast(`Adult Mode unlocked on this signed-in session for up to ${hours} hours.`, "ok");
      continueOriginalClick(button);
    } catch (error) {
      if (error?.name === "NotAllowedError") {
        showToast("Adult Mode unlock was canceled or timed out.", "error");
      } else if (error?.passkeyRegistrationRequired || error?.code === "PASSKEY_REGISTRATION_REQUIRED") {
        showToast("Register a passkey in Account → Passkeys before using Adult Mode.", "error");
      } else {
        showToast(error?.message || "Adult Mode device verification failed.", "error");
      }
    } finally {
      busy = false;
      delete button.dataset.adultUnlockBusy;
      button.title = previousTitle;
    }
  }

  document.addEventListener("click", interceptAdultClick, true);
})();
