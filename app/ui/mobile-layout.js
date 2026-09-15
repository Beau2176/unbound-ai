const MOBILE_LAYOUT_STYLE_ID = "unbound-mobile-layout-v102";
const MOBILE_LAYOUT_SCRIPT_ID = "unbound-mobile-menu-v102";

const MOBILE_LAYOUT_STYLES = `<style id="${MOBILE_LAYOUT_STYLE_ID}">
.mobile-quickbar,
.mobile-menu-button,
.mobile-menu-panel {
  display: none;
}

@media (min-width: 761px) {
  .page {
    padding-top: clamp(180px, 30vh, 320px);
  }

  .chat-head {
    flex-wrap: wrap;
  }

  .chat-head > div:first-child {
    flex: 1 1 280px;
  }

  .chat-actions {
    flex: 1 1 520px;
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  html,
  body {
    max-width: 100%;
    overflow-x: hidden;
  }

  body {
    background-attachment: scroll !important;
  }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 9px;
    background: rgba(3, 8, 16, 0.94);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .brand {
    width: auto;
    min-width: 0;
    gap: 7px;
    flex: 0 1 auto;
  }

  .mark {
    width: 30px;
    height: 26px;
    flex: 0 0 30px;
  }

  .brand-name {
    font-size: 13px;
    letter-spacing: .14em;
    white-space: nowrap;
  }

  .tagline,
  .status {
    display: none !important;
  }

  .topbar-right {
    display: flex !important;
    width: auto;
    max-width: 100%;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 6px !important;
    flex: 0 1 auto;
    flex-wrap: nowrap !important;
    overflow: hidden !important;
  }

  .topbar-right > * {
    flex: 0 0 auto;
    max-width: 100%;
  }

  .topbar-right .account-button,
  .topbar-right .logout-button {
    min-height: 40px;
    padding: 8px 10px;
    border-radius: 10px;
    font-size: 10px;
    white-space: nowrap;
  }

  .auth-actions,
  .user-menu {
    min-width: 0;
    max-width: 100%;
    flex-wrap: nowrap !important;
    gap: 5px !important;
  }

  .user-pill {
    min-width: 40px;
    max-width: 44px;
    min-height: 40px;
    padding: 4px;
    overflow: hidden;
  }

  .user-meta {
    display: none !important;
  }

  .page {
    width: calc(100% - 10px);
    padding-top: clamp(18px, 4vh, 42px);
    padding-bottom: 14px;
  }

  .service-banner {
    width: 100%;
    margin-bottom: 8px;
    padding: 9px 11px;
    border-radius: 12px;
  }

  .chat-shell {
    width: 100%;
    max-width: 100%;
    border-radius: 17px;
    overflow: hidden;
  }

  .chat-head {
    display: none !important;
  }

  .mobile-quickbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
    padding: 9px 10px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(4, 10, 21, 0.82);
  }

  .mobile-mode-summary {
    flex: 1 0 100%;
    overflow: hidden;
    color: #9fc9e8;
    font-size: 10px;
    font-weight: 850;
    letter-spacing: .035em;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobile-quickbar .new-chat,
  .mobile-chat-options-button {
    flex: 1 1 0;
    min-width: 0;
    min-height: 44px;
    padding: 9px 8px;
    border-radius: 11px;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: .045em;
    text-align: center;
    white-space: nowrap;
  }

  .mobile-chat-options-button {
    border: 1px solid rgba(255, 173, 67, 0.36);
    background: rgba(255, 173, 67, 0.08);
    color: #ffd297;
    cursor: pointer;
  }

  .messages {
    min-height: 200px;
    max-height: min(60dvh, 620px);
    padding: 14px 11px 8px;
  }

  .message {
    max-width: 94%;
    overflow-wrap: anywhere;
    font-size: 15px;
  }

  .composer-wrap {
    padding: 9px;
  }

  .composer {
    min-width: 0;
    max-width: 100%;
    gap: 8px;
    padding: 7px 7px 7px 12px;
  }

  .composer textarea {
    min-width: 0;
    min-height: 52px;
    font-size: 16px;
  }

  .send {
    width: 48px;
    height: 48px;
    flex: 0 0 48px;
  }

  .mode-row {
    justify-content: flex-end;
    margin-top: 6px;
  }

  .mode-row .hint {
    display: none !important;
  }

  .go-deeper {
    min-height: 40px;
    padding: 8px 12px;
  }

  .footer-line {
    display: none !important;
  }

  .mobile-menu-button {
    display: inline-grid;
    place-items: center;
    width: 44px;
    min-width: 44px;
    max-width: 44px;
    height: 44px;
    min-height: 44px;
    padding: 0;
    border: 1px solid rgba(107, 193, 255, 0.34);
    border-radius: 11px;
    background: rgba(66, 165, 255, 0.10);
    color: #edf8ff;
    cursor: pointer;
    font-size: 22px;
    line-height: 1;
  }

  .mobile-menu-panel {
    position: fixed;
    top: var(--unbound-mobile-menu-top, 64px);
    left: 8px;
    right: 8px;
    z-index: 110;
    display: none;
    max-width: calc(100vw - 16px);
    max-height: calc(100dvh - var(--unbound-mobile-menu-top, 64px) - 12px);
    overflow-x: hidden;
    overflow-y: auto;
    padding: 12px;
    border: 1px solid rgba(107, 193, 255, 0.38);
    border-radius: 16px;
    background: rgba(4, 10, 21, 0.985);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.68);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .mobile-menu-panel[data-open="true"] {
    display: block;
  }

  .mobile-menu-title {
    margin: 0 0 10px;
    color: #9fc9e8;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: .10em;
    text-transform: uppercase;
  }

  .mobile-menu-section {
    min-width: 0;
    max-width: 100%;
  }

  .mobile-menu-section + .mobile-menu-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(255,255,255,.08);
  }

  .mobile-menu-section > * {
    max-width: 100%;
    box-sizing: border-box;
  }

  .mobile-menu-section > * + * {
    margin-top: 8px;
  }

  .mobile-menu-panel .account-button,
  .mobile-menu-panel .logout-button,
  .mobile-menu-panel .advertiser-link {
    width: 100%;
    min-height: 44px;
    justify-content: center;
  }

  .mobile-menu-panel .product-control,
  .mobile-menu-panel .depth-control,
  .mobile-menu-panel .style-control {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  .mobile-menu-panel .product-control {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    padding: 6px;
  }

  .mobile-menu-panel .product-button,
  .mobile-menu-panel .depth-button {
    min-height: 44px;
    text-align: center;
  }

  .mobile-menu-panel .depth-control {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mobile-menu-panel .style-control {
    display: flex;
    min-height: 44px;
    padding: 7px 10px;
  }

  .mobile-menu-panel .style-control select {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    max-width: none;
    min-height: 32px;
  }

  .mobile-menu-panel .age {
    display: block !important;
    width: 100%;
    text-align: center;
  }
}

@media (max-width: 430px) {
  .topbar {
    padding: 6px 7px;
  }

  .brand-name {
    font-size: 12px;
    letter-spacing: .11em;
  }

  .mark {
    width: 27px;
    flex-basis: 27px;
  }

  .topbar-right {
    gap: 4px !important;
  }

  .topbar-right .account-button,
  .topbar-right .logout-button {
    padding: 7px 8px;
    font-size: 9px;
  }

  .page {
    width: calc(100% - 6px);
    padding-top: 14px;
  }

  .mobile-quickbar {
    padding-left: 8px;
    padding-right: 8px;
  }

  .mobile-quickbar .new-chat,
  .mobile-chat-options-button {
    font-size: 9px;
  }

  .messages {
    max-height: 62dvh;
    padding-left: 9px;
    padding-right: 9px;
  }
}
</style>`;

const MOBILE_LAYOUT_SCRIPT = `<script id="${MOBILE_LAYOUT_SCRIPT_ID}">
(() => {
  const MOBILE_QUERY = "(max-width: 760px)";
  const moved = [];
  let initialized = false;

  function rememberAndMove(node, target) {
    if (!node || !target || moved.some((entry) => entry.node === node)) return;
    const marker = document.createComment("unbound-mobile-origin");
    node.parentNode.insertBefore(marker, node);
    moved.push({ node, marker });
    target.appendChild(node);
  }

  function restoreAll() {
    for (const entry of moved) {
      if (entry.marker.parentNode) {
        entry.marker.parentNode.insertBefore(entry.node, entry.marker.nextSibling);
      }
    }
  }

  function moveRemembered() {
    for (const entry of moved) {
      const targetId = entry.node.dataset.unboundMobileTarget;
      const target = targetId ? document.getElementById(targetId) : null;
      if (target && entry.node.parentNode !== target) target.appendChild(entry.node);
    }
  }

  function setMenuTop() {
    const topbar = document.querySelector(".topbar");
    const top = topbar ? Math.ceil(topbar.getBoundingClientRect().bottom + 6) : 64;
    document.documentElement.style.setProperty("--unbound-mobile-menu-top", top + "px");
  }

  function titleCase(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/(^|[\\s_-])([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
  }

  function syncModeSummary() {
    const summary = document.getElementById("mobileModeSummary");
    if (!summary) return;

    const product = document.querySelector(".product-button.active");
    const depth = document.querySelector(".depth-button.active");
    const style = document.getElementById("aiStyleSelect");
    const productName = product ? titleCase(product.dataset.productMode || product.textContent) : "Standard";
    const depthName = depth ? titleCase(depth.dataset.depthStyle || depth.textContent) : "Casual";
    const styleName = style ? titleCase(style.value) : "Balanced";
    summary.textContent = "Current: " + productName + " • " + depthName + " • " + styleName;
  }

  function buildMenu() {
    if (initialized) return;
    initialized = true;

    const topbarRight = document.querySelector(".topbar-right");
    const chatShell = document.querySelector(".chat-shell");
    const messages = document.querySelector(".messages");
    if (!topbarRight || !chatShell || !messages) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-menu-button";
    button.id = "mobileMenuButton";
    button.setAttribute("aria-label", "Open account and site menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "mobileMenuPanel");
    button.textContent = "☰";
    topbarRight.appendChild(button);

    const panel = document.createElement("div");
    panel.className = "mobile-menu-panel";
    panel.id = "mobileMenuPanel";
    panel.setAttribute("data-open", "false");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "UNBOUND AI options");

    const navSection = document.createElement("div");
    navSection.className = "mobile-menu-section";
    navSection.id = "mobileMenuNav";
    navSection.innerHTML = '<div class="mobile-menu-title">Account & site</div>';

    const chatSection = document.createElement("div");
    chatSection.className = "mobile-menu-section";
    chatSection.id = "mobileMenuChat";
    chatSection.innerHTML = '<div class="mobile-menu-title">Chat options</div>';

    panel.append(navSection, chatSection);
    document.body.appendChild(panel);

    const quickBar = document.createElement("div");
    quickBar.className = "mobile-quickbar";
    quickBar.id = "mobileQuickBar";
    quickBar.setAttribute("aria-label", "Quick chat controls");

    const modeSummary = document.createElement("div");
    modeSummary.className = "mobile-mode-summary";
    modeSummary.id = "mobileModeSummary";
    quickBar.appendChild(modeSummary);

    const chatOptionsButton = document.createElement("button");
    chatOptionsButton.type = "button";
    chatOptionsButton.className = "mobile-chat-options-button";
    chatOptionsButton.id = "mobileChatOptionsButton";
    chatOptionsButton.textContent = "CHAT OPTIONS";
    chatOptionsButton.setAttribute("aria-controls", panel.id);
    chatOptionsButton.setAttribute("aria-expanded", "false");

    chatShell.insertBefore(quickBar, messages);

    const keepTopLevel = (node) => {
      if (node === button) return true;
      if (node.classList && (node.classList.contains("auth-actions") || node.classList.contains("user-menu"))) return true;
      return false;
    };

    for (const child of Array.from(topbarRight.children)) {
      if (!keepTopLevel(child)) {
        child.dataset.unboundMobileTarget = navSection.id;
        rememberAndMove(child, navSection);
      }
    }

    const userMenu = topbarRight.querySelector(".user-menu");
    if (userMenu) {
      for (const child of Array.from(userMenu.children)) {
        if (child.matches && child.matches("button, a")) {
          child.dataset.unboundMobileTarget = navSection.id;
          rememberAndMove(child, navSection);
        }
      }
    }

    const authActions = topbarRight.querySelector(".auth-actions");
    if (authActions) {
      const actionable = Array.from(authActions.children).filter((node) => node.matches && node.matches("button, a"));
      const login = actionable.find((node) => /log\\s*in|sign\\s*in/i.test(node.textContent || "")) || actionable[0];
      for (const child of actionable) {
        if (child !== login) {
          child.dataset.unboundMobileTarget = navSection.id;
          rememberAndMove(child, navSection);
        }
      }
    }

    const chatActions = document.querySelector(".chat-actions");
    const historyButton = document.getElementById("historyButton");
    const newChatButton = document.getElementById("newChatButton");

    if (newChatButton) {
      newChatButton.dataset.unboundMobileTarget = quickBar.id;
      rememberAndMove(newChatButton, quickBar);
    }

    if (historyButton) {
      historyButton.dataset.unboundMobileTarget = quickBar.id;
      rememberAndMove(historyButton, quickBar);
    }

    quickBar.appendChild(chatOptionsButton);

    if (chatActions) {
      for (const child of Array.from(chatActions.children)) {
        if (child === newChatButton || child === historyButton) continue;
        child.dataset.unboundMobileTarget = chatSection.id;
        rememberAndMove(child, chatSection);
      }
    }

    function closeMenu() {
      panel.setAttribute("data-open", "false");
      button.setAttribute("aria-expanded", "false");
      chatOptionsButton.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Open account and site menu");
    }

    function openMenu(focusChatOptions) {
      setMenuTop();
      panel.setAttribute("data-open", "true");
      button.setAttribute("aria-expanded", "true");
      chatOptionsButton.setAttribute("aria-expanded", "true");
      button.setAttribute("aria-label", "Close account and site menu");
      if (focusChatOptions) {
        window.setTimeout(() => {
          panel.scrollTop = Math.max(0, chatSection.offsetTop - 8);
        }, 0);
      } else {
        panel.scrollTop = 0;
      }
    }

    button.addEventListener("click", () => {
      panel.getAttribute("data-open") === "true" ? closeMenu() : openMenu(false);
    });

    chatOptionsButton.addEventListener("click", () => {
      panel.getAttribute("data-open") === "true" ? closeMenu() : openMenu(true);
    });

    document.addEventListener("click", (event) => {
      if (panel.getAttribute("data-open") !== "true") return;
      if (panel.contains(event.target) || button.contains(event.target) || chatOptionsButton.contains(event.target)) return;
      closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    panel.addEventListener("click", (event) => {
      const control = event.target.closest("a, button");
      if (control && !control.closest(".depth-control, .product-control")) closeMenu();
      if (control && control.closest(".depth-control, .product-control")) {
        window.setTimeout(syncModeSummary, 0);
      }
    });

    const styleSelect = document.getElementById("aiStyleSelect");
    if (styleSelect) styleSelect.addEventListener("change", syncModeSummary);

    window.addEventListener("resize", setMenuTop, { passive: true });
    syncModeSummary();
  }

  function syncLayout() {
    buildMenu();
    const mobile = window.matchMedia(MOBILE_QUERY).matches;
    const button = document.getElementById("mobileMenuButton");
    const panel = document.getElementById("mobileMenuPanel");
    const quickBar = document.getElementById("mobileQuickBar");

    if (mobile) {
      moveRemembered();
      if (button) button.hidden = false;
      if (panel) panel.hidden = false;
      if (quickBar) quickBar.hidden = false;
      setMenuTop();
      syncModeSummary();
    } else {
      restoreAll();
      if (button) button.hidden = true;
      if (quickBar) quickBar.hidden = true;
      if (panel) {
        panel.hidden = true;
        panel.setAttribute("data-open", "false");
      }
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    syncLayout();
    const media = window.matchMedia(MOBILE_QUERY);
    if (typeof media.addEventListener === "function") media.addEventListener("change", syncLayout);
    else if (typeof media.addListener === "function") media.addListener(syncLayout);
  });
})();
</script>`;

function injectMobileLayoutStyles(html) {
  const source = String(html || "");
  if (
    source.includes(`id="${MOBILE_LAYOUT_STYLE_ID}"`) ||
    source.includes(`id="${MOBILE_LAYOUT_SCRIPT_ID}"`)
  ) {
    return source;
  }

  const headMarker = "</head>";
  const bodyMarker = "</body>";
  const headFirst = source.indexOf(headMarker);
  const headLast = source.lastIndexOf(headMarker);
  const bodyFirst = source.indexOf(bodyMarker);
  const bodyLast = source.lastIndexOf(bodyMarker);

  if (headFirst === -1 || headFirst !== headLast) {
    const error = new Error("UNBOUND AI mobile layout head marker is missing or ambiguous.");
    error.code = "MOBILE_LAYOUT_HEAD_MARKER_INVALID";
    throw error;
  }
  if (bodyFirst === -1 || bodyFirst !== bodyLast) {
    const error = new Error("UNBOUND AI mobile layout body marker is missing or ambiguous.");
    error.code = "MOBILE_LAYOUT_BODY_MARKER_INVALID";
    throw error;
  }

  const withStyles = source.slice(0, headFirst) + `  ${MOBILE_LAYOUT_STYLES}\n` + source.slice(headFirst);
  const finalBodyIndex = withStyles.lastIndexOf(bodyMarker);
  return withStyles.slice(0, finalBodyIndex) + `  ${MOBILE_LAYOUT_SCRIPT}\n` + withStyles.slice(finalBodyIndex);
}

module.exports = {
  MOBILE_LAYOUT_STYLE_ID,
  MOBILE_LAYOUT_SCRIPT_ID,
  MOBILE_LAYOUT_STYLES,
  MOBILE_LAYOUT_SCRIPT,
  injectMobileLayoutStyles
};