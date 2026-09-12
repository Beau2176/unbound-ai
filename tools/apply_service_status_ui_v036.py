from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("app/index.html")
text = path.read_text()

text = replace_once(
    text,
    '''    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 12px rgba(101, 232, 164, 0.78);
    }
      [hidden] {
''',
    '''    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 12px rgba(101, 232, 164, 0.78);
    }

    .status[data-state="checking"] {
      border-color: rgba(107, 193, 255, 0.28);
      background: rgba(24, 64, 100, 0.20);
      color: #bfe4ff;
    }

    .status[data-state="checking"] .status-dot {
      background: var(--blue-bright);
      box-shadow: 0 0 12px rgba(107, 193, 255, 0.70);
    }

    .status[data-state="maintenance"] {
      border-color: rgba(255, 173, 67, 0.42);
      background: rgba(116, 68, 12, 0.26);
      color: #ffd297;
    }

    .status[data-state="maintenance"] .status-dot {
      background: var(--gold);
      box-shadow: 0 0 12px rgba(255, 173, 67, 0.72);
    }

    .status[data-state="degraded"] {
      border-color: rgba(255, 118, 118, 0.40);
      background: rgba(112, 25, 33, 0.26);
      color: #ffd4d4;
    }

    .status[data-state="degraded"] .status-dot {
      background: var(--danger);
      box-shadow: 0 0 12px rgba(255, 118, 118, 0.70);
    }

    .service-banner {
      width: min(940px, 100%);
      margin: 0 auto 12px;
      padding: 12px 15px;
      border: 1px solid rgba(255, 173, 67, 0.36);
      border-radius: 14px;
      background: rgba(80, 45, 8, 0.88);
      color: #ffe5bd;
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      font-size: 12px;
      line-height: 1.5;
    }

    .service-banner[data-state="degraded"] {
      border-color: rgba(255, 118, 118, 0.38);
      background: rgba(84, 20, 28, 0.90);
      color: #ffd7d7;
    }

    .service-banner strong {
      display: block;
      margin-bottom: 2px;
      color: #ffffff;
      font-size: 12px;
      letter-spacing: 0.04em;
    }

    .composer textarea:disabled,
    .send:disabled {
      cursor: not-allowed;
      opacity: 0.58;
    }

      [hidden] {
''',
    "service status css",
)

text = replace_once(
    text,
    '''      <div class="status" aria-label="Service status live">
        <span class="status-dot"></span>
        LIVE
      </div>
''',
    '''      <div id="serviceStatus" class="status" data-state="checking" role="status" aria-live="polite" aria-label="Service status checking">
        <span class="status-dot" aria-hidden="true"></span>
        <span id="serviceStatusText">CHECKING</span>
      </div>
''',
    "service status markup",
)

text = replace_once(
    text,
    '''  <main id="main-content" class="page" tabindex="-1">
    <section class="chat-shell" aria-label="UNBOUND AI chat">
''',
    '''  <main id="main-content" class="page" tabindex="-1">
    <div id="serviceBanner" class="service-banner" role="status" aria-live="polite" hidden>
      <strong id="serviceBannerTitle">Service notice</strong>
      <span id="serviceBannerMessage"></span>
    </div>

    <section class="chat-shell" aria-label="UNBOUND AI chat">
''',
    "service banner markup",
)

text = replace_once(
    text,
    '''    const form = document.getElementById("chatForm");
    const input = document.getElementById("message");
    const sendButton = document.getElementById("sendButton");
''',
    '''    const form = document.getElementById("chatForm");
    const input = document.getElementById("message");
    const sendButton = document.getElementById("sendButton");
    const serviceStatus = document.getElementById("serviceStatus");
    const serviceStatusText = document.getElementById("serviceStatusText");
    const serviceBanner = document.getElementById("serviceBanner");
    const serviceBannerTitle = document.getElementById("serviceBannerTitle");
    const serviceBannerMessage = document.getElementById("serviceBannerMessage");
''',
    "service status dom refs",
)

text = replace_once(
    text,
    '''    let currentRecoveryCodes = [];
    let modalReturnFocus = null;

    function rememberModalReturnFocus() {
''',
    '''    let currentRecoveryCodes = [];
    let modalReturnFocus = null;
    let serviceWriteBlocked = false;
    let serviceWriteBlockMessage = "UNBOUND AI is temporarily unavailable for new messages.";
    let serviceStatusTimer = null;

    function renderServiceStatus(payload, { reachable = true } = {}) {
      const maintenance = payload?.components?.maintenance || {};
      const backendStatus = String(payload?.status || "").toLowerCase();

      if (!reachable) {
        serviceStatus.dataset.state = "degraded";
        serviceStatusText.textContent = "STATUS UNKNOWN";
        serviceStatus.setAttribute("aria-label", "Service status could not be verified");
        serviceBanner.hidden = false;
        serviceBanner.dataset.state = "degraded";
        serviceBannerTitle.textContent = "Service status could not be verified";
        serviceBannerMessage.textContent = "The status check failed. You can still try to send a message.";
        serviceWriteBlocked = false;
      } else if (maintenance.active) {
        serviceStatus.dataset.state = "maintenance";
        serviceStatusText.textContent = "MAINTENANCE";
        serviceStatus.setAttribute("aria-label", "Service in maintenance mode");
        serviceBanner.hidden = false;
        serviceBanner.dataset.state = "maintenance";
        serviceBannerTitle.textContent = maintenance.mode === "read_only"
          ? "UNBOUND AI is temporarily read-only"
          : "UNBOUND AI maintenance";
        serviceWriteBlockMessage = maintenance.message || "UNBOUND AI is temporarily in maintenance mode.";
        serviceBannerMessage.textContent = serviceWriteBlockMessage;
        serviceWriteBlocked = Boolean(maintenance.writeBlocked || maintenance.serviceUnavailable);
      } else if (payload?.operational === true || backendStatus === "ready") {
        serviceStatus.dataset.state = "live";
        serviceStatusText.textContent = "LIVE";
        serviceStatus.setAttribute("aria-label", "Service status live");
        serviceBanner.hidden = true;
        serviceBanner.dataset.state = "";
        serviceBannerTitle.textContent = "Service notice";
        serviceBannerMessage.textContent = "";
        serviceWriteBlocked = false;
      } else {
        serviceStatus.dataset.state = "degraded";
        serviceStatusText.textContent = backendStatus === "draining" ? "RESTARTING" : "DEGRADED";
        serviceStatus.setAttribute("aria-label", "Service temporarily not ready");
        serviceBanner.hidden = false;
        serviceBanner.dataset.state = "degraded";
        serviceBannerTitle.textContent = backendStatus === "draining"
          ? "UNBOUND AI is restarting"
          : "UNBOUND AI is temporarily unavailable";
        serviceWriteBlockMessage = backendStatus === "draining"
          ? "A service restart is in progress. New messages will resume automatically when the service is ready."
          : "UNBOUND AI is not ready for new messages right now. The page will keep checking automatically.";
        serviceBannerMessage.textContent = serviceWriteBlockMessage;
        serviceWriteBlocked = true;
      }

      input.disabled = serviceWriteBlocked;
      sendButton.disabled = serviceWriteBlocked;
      goDeeperButton.disabled = serviceWriteBlocked;
      input.placeholder = serviceWriteBlocked
        ? "Chat temporarily paused..."
        : "Message UNBOUND AI...";
    }

    async function refreshServiceStatus() {
      try {
        const response = await fetch("/api/system/status", {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" },
          cache: "no-store"
        });
        const payload = await readJson(response);
        if (!payload || typeof payload !== "object" || !payload.status) {
          throw new Error("Service status response was invalid.");
        }
        renderServiceStatus(payload, { reachable: true });
        return payload;
      } catch (error) {
        console.warn("Could not verify UNBOUND AI service status:", error);
        renderServiceStatus(null, { reachable: false });
        return null;
      }
    }

    function startServiceStatusPolling() {
      if (serviceStatusTimer) return;
      serviceStatusTimer = window.setInterval(() => {
        refreshServiceStatus().catch(() => {});
      }, 30000);
    }

    function rememberModalReturnFocus() {
''',
    "service status functions",
)

text = replace_once(
    text,
    '''    async function sendMessage() {
      const message = input.value.trim();

      if (!message) {
        return;
      }
''',
    '''    async function sendMessage() {
      if (serviceWriteBlocked) {
        showToast(serviceWriteBlockMessage);
        return;
      }

      const message = input.value.trim();

      if (!message) {
        return;
      }
''',
    "send maintenance guard",
)

text = replace_once(
    text,
    '''      } finally {
        sendButton.disabled = false;
        goDeeperButton.disabled = false;
        updateGoDeeperVisibility();
      }
    }

    async function goDeeper() {
      if (sendButton.disabled || !conversationHistory.length) {
''',
    '''      } finally {
        sendButton.disabled = serviceWriteBlocked;
        goDeeperButton.disabled = serviceWriteBlocked;
        input.disabled = serviceWriteBlocked;
        updateGoDeeperVisibility();
      }
    }

    async function goDeeper() {
      if (serviceWriteBlocked || sendButton.disabled || !conversationHistory.length) {
''',
    "send final availability",
)

text = replace_once(
    text,
    '''    async function initializePage() {
      passkeyLoginButton.hidden = !passkeysSupported();
''',
    '''    async function initializePage() {
      serviceStatus.dataset.state = "checking";
      serviceStatusText.textContent = "CHECKING";
      await refreshServiceStatus();
      startServiceStatusPolling();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          refreshServiceStatus().catch(() => {});
        }
      });

      passkeyLoginButton.hidden = !passkeysSupported();
''',
    "page initialization status",
)

path.write_text(text)
print("Applied truthful service status UI v0.36 migration.")
