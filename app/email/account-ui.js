(() => {
  "use strict";

  const STATUS_URL = "/api/email-verification/status";
  const SEND_URL = "/api/email-verification/send";
  const RESEND_URL = "/api/email-verification/resend";

  let modal = null;
  let statusValue = null;
  let actionButton = null;
  let note = null;
  let currentState = null;
  let requestInFlight = false;

  function createElement(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.id) element.id = options.id;
    if (options.className) element.className = options.className;
    if (options.text) element.textContent = options.text;
    if (options.type) element.type = options.type;
    return element;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      ...options
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const error = new Error(payload?.error || "Email verification is temporarily unavailable.");
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  function stateLabel(state) {
    if (state?.verified) return "Verified";
    switch (state?.state) {
      case "pending": return "Pending — check your inbox";
      case "expired": return "Expired — send a new link";
      case "failed": return "Delivery failed — try again";
      default: return "Not verified";
    }
  }

  function noteText(state) {
    if (state?.verified) return "Your account email has been verified.";
    if (state?.state === "pending" && state?.expiresAt) {
      const expires = new Date(state.expiresAt);
      if (Number.isFinite(expires.getTime())) {
        return `A one-time link was sent. It expires ${expires.toLocaleString()}.`;
      }
    }
    if (state?.canSend) {
      return "Verify your account email with a one-time link. The link is never shown in account status.";
    }
    return "Email verification sending is not available yet.";
  }

  function render(state) {
    currentState = state || null;
    if (!statusValue || !actionButton || !note) return;

    statusValue.textContent = stateLabel(state);
    note.textContent = noteText(state);

    const verified = Boolean(state?.verified);
    const canSend = Boolean(state?.canSend) && !verified;
    actionButton.hidden = !canSend;
    actionButton.disabled = requestInFlight || !canSend;
    actionButton.textContent = state?.state === "unverified"
      ? "SEND VERIFICATION EMAIL"
      : "RESEND VERIFICATION EMAIL";
  }

  function renderUnavailable(message) {
    currentState = null;
    if (statusValue) statusValue.textContent = "Unavailable";
    if (actionButton) {
      actionButton.hidden = true;
      actionButton.disabled = true;
    }
    if (note) note.textContent = message || "Email verification is temporarily unavailable.";
  }

  async function refreshStatus() {
    if (!modal || modal.hidden || requestInFlight) return;
    try {
      const payload = await requestJson(STATUS_URL);
      render(payload?.verification || null);
    } catch (error) {
      if (error?.status === 401) {
        renderUnavailable("Sign in to manage account email verification.");
        return;
      }
      renderUnavailable(error?.message);
    }
  }

  async function handleVerificationAction() {
    if (requestInFlight || !currentState?.canSend || currentState?.verified) return;

    requestInFlight = true;
    actionButton.disabled = true;
    const previousLabel = actionButton.textContent;
    actionButton.textContent = "SENDING…";
    note.textContent = "Sending a secure one-time verification link…";

    const endpoint = currentState.state === "unverified" ? SEND_URL : RESEND_URL;
    try {
      await requestJson(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: "{}"
      });
      requestInFlight = false;
      await refreshStatus();
    } catch (error) {
      requestInFlight = false;
      actionButton.textContent = previousLabel;
      actionButton.disabled = false;
      note.textContent = error?.message || "Verification email could not be sent.";
    }
  }

  function buildPanel(anchor) {
    const panel = createElement("section", {
      id: "emailVerificationAccountPanel",
      className: "access-age-actions"
    });
    panel.setAttribute("aria-labelledby", "emailVerificationTitle");

    const stat = createElement("div", { className: "access-stat" });
    const label = createElement("div", {
      id: "emailVerificationTitle",
      className: "access-label",
      text: "Account email verification"
    });
    statusValue = createElement("div", {
      id: "emailVerificationStatus",
      className: "access-value",
      text: "Checking…"
    });
    stat.append(label, statusValue);

    actionButton = createElement("button", {
      id: "emailVerificationActionButton",
      className: "auth-submit secondary",
      type: "button",
      text: "SEND VERIFICATION EMAIL"
    });
    actionButton.hidden = true;
    actionButton.addEventListener("click", handleVerificationAction);

    note = createElement("div", {
      id: "emailVerificationActionNote",
      className: "history-empty",
      text: ""
    });
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");

    panel.append(stat, actionButton, note);
    anchor.parentNode.insertBefore(panel, anchor);
  }

  function install() {
    modal = document.getElementById("accessModal");
    const anchor = document.getElementById("ageVerificationActions");
    if (!modal || !anchor || document.getElementById("emailVerificationAccountPanel")) return;

    buildPanel(anchor);

    const observer = new MutationObserver(() => {
      if (!modal.hidden) void refreshStatus();
    });
    observer.observe(modal, { attributes: true, attributeFilter: ["hidden"] });

    if (!modal.hidden) void refreshStatus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
