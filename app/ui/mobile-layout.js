const MOBILE_LAYOUT_STYLE_ID = "unbound-mobile-layout-v101";
const MOBILE_LAYOUT_SCRIPT_ID = "unbound-mobile-menu-v101";

const MOBILE_LAYOUT_STYLES = `<style id="${MOBILE_LAYOUT_STYLE_ID}">
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
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 7px;
    padding: 8px 10px;
    background: rgba(3, 8, 16, 0.92);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .brand {
    width: 100%;
    min-width: 0;
    gap: 8px;
  }

  .mark {
    width: 30px;
    height: 26px;
    flex: 0 0 30px;
  }

  .brand-name {
    font-size: 13px;
    letter-spacing: .16em;
    white-space: nowrap;
  }

  .tagline,
  .status {
    display: none !important;
  }

  .topbar-right {
    display: flex !important;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 6px !important;
    flex-wrap: nowrap !important;
    overflow: hidden !important;
  }

  .topbar-right > * {
    flex: 0 0 auto;
    max-width: 100%;
  }

  .topbar-right .account-button,
  .topbar-right .logout-button,
  .mobile-menu-button {
    min-height: 34px;
    padding: 7px 9px;
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
    min-width: 38px;
    max-width: 44px;
    padding: 4px;
    overflow: hidden;
  }

  .user-meta {
    display: none !important;
  }

  .page {
    width: calc(100% - 12px);
    padding-top: clamp(34px, 8vh, 72px);
    padding-bottom: 18px;
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
    border-radius: 18px;
    overflow: hidden;
  }

  .chat-head {
    display: none !important;
  }

  .messages {
    min-height: 180px;
    max-height: 58vh;
    padding: 14px 12px 8px;
  }

  .message {
    max-width: 94%;
    overflow-wrap: anywhere;
    font-size: 14px;
  }

  .composer-wrap {
    padding: 10px;
  }

  .composer {
    min-width: 0;
    max-width: 100%;
    gap: 8px;
  }

  .composer textarea {
    min-width: 0;
    min-height: 52px;
    font-size: 16px;
  }

  .send {
    width: 46px;
    height: 46px;
    flex: 0 0 46px;
  }

  .mode-row {
    margin-top: 7px;
  }

  .footer-line {
    display: none !important;
  }

  .mobile-menu-button {
    display: inline-grid;
    place-items: center;
    width: 36px;
    min-width: 36px;
    max-width: 36px;
    padding: 0;
    border: 1px solid rgba(107, 193, 255, 0.34);
    background: rgba(66, 165, 255, 0.10);
    color: #edf8ff;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
  }

  .mobile-menu-panel {
    position: fixed;
    top: var(--unbound-mobile-menu-top, 88px);
    left: 8px;
    right: 8px;
    z-index: 110;
    display: none;
    max-width: calc(100vw - 16px);
    max-height: calc(100dvh - var(--unbound-mobile-menu-top, 88px) - 12px);
    overflow-x: hidden;
    overflow-y: auto;
    padding: 12px;
    border: 1px solid rgba(107, 193, 255, 0.38);
    border-radius: 16px;
    background: rgba(4, 10, 21, 0.98);
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
  .mobile-menu-panel .new-chat,
  .mobile-menu-panel .advertiser-link {
    width: 100%;
    min-height: 42px;
    justify-content: center;
  }

  .mobile-menu-panel .chat-actions {
    display: grid !important;
    width: 100%;
    margin: 0;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
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
    min-height: 38px;
    text-align: center;
  }

  .mobile-menu-panel .depth-control {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mobile-menu-panel .style-control {
    display: flex;
  }

  .mobile-menu-panel .style-control select {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    max-width: none;
  }
}

@media (max-width: 430px) {
  .topbar {
    padding: 7px 8px;
  }

  .brand-name {
    font-size: 12px;
    letter-spacing: .13em;
  }

  .topbar-right {
    gap: 4px !important;
  }

  .topbar-right .account-button,
  .topbar-right .logout-button {
    padding: 6px 7px;
    font-size: 9px;
  }

  .page {
    width: calc(100% - 8px);
    padding-top: 26px;
  }

  .messages {
    max-height: 61vh;
    padding-left: 10px;
    padding-right: 10px;
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
    const top = topbar ? Math.ceil(topbar.getBoundingClientRect().bottom + 6) : 88;
    document.documentElement.style.setProperty("--unbound-mobile-menu-top", top + "px");
  }

  function buildMenu() {
    if (initialized) return;
    initialized = true;

    const topbarRight = document.querySelector(".topbar-right");
    if (!topbarRight) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-menu-button";
    button.id = "mobileMenuButton";
    button.setAttribute("aria-label", "Open more options");
    button.setAttribute("aria-expanded", "false");
    button.textContent = "☰";
    topbarRight.appendChild(button);

    const panel = document.createElement("div");
    panel.className = "mobile-menu-panel";
    panel.id = "mobileMenuPanel";
    panel.setAttribute("data-open", "false");
    panel.setAttribute("role", "menu");

    const navSection = document.createElement("div");
    navSection.className = "mobile-menu-section";
    navSection.id = "mobileMenuNav";
    navSection.innerHTML = '<div class="mobile-menu-title">More</div>';

    const chatSection = document.createElement("div");
    chatSection.className = "mobile-menu-section";
    chatSection.id = "mobileMenuChat";
    chatSection.innerHTML = '<div class="mobile-menu-title">Chat options</div>';

    panel.append(navSection, chatSection);
    document.body.appendChild(panel);

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
      const login = actionable.find((node) => /log\s*in|sign\s*in/i.test(node.textContent || "")) || actionable[0];
      for (const child of actionable) {
        if (child !== login) {
          child.dataset.unboundMobileTarget = navSection.id;
          rememberAndMove(child, navSection);
        }
      }
    }

    const chatActions = document.querySelector(".chat-actions");
    if (chatActions) {
      chatActions.dataset.unboundMobileTarget = chatSection.id;
      rememberAndMove(chatActions, chatSection);
    }

    function closeMenu() {
      panel.setAttribute("data-open", "false");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Open more options");
    }

    function openMenu() {
      setMenuTop();
      panel.setAttribute("data-open", "true");
      button.setAttribute("aria-expanded", "true");
      button.setAttribute("aria-label", "Close more options");
    }

    button.addEventListener("click", () => {
      panel.getAttribute("data-open") === "true" ? closeMenu() : openMenu();
    });

    document.addEventListener("click", (event) => {
      if (panel.getAttribute("data-open") !== "true") return;
      if (panel.contains(event.target) || button.contains(event.target)) return;
      closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    panel.addEventListener("click", (event) => {
      const control = event.target.closest("a, button");
      if (control && !control.closest(".depth-control, .product-control")) closeMenu();
    });

    window.addEventListener("resize", setMenuTop, { passive: true });
  }

  function syncLayout() {
    buildMenu();
    const mobile = window.matchMedia(MOBILE_QUERY).matches;
    const button = document.getElementById("mobileMenuButton");
    const panel = document.getElementById("mobileMenuPanel");

    if (mobile) {
      moveRemembered();
      if (button) button.hidden = false;
      if (panel) panel.hidden = false;
      setMenuTop();
    } else {
      restoreAll();
      if (button) button.hidden = true;
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