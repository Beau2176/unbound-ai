const SIMPLE_SHELL_STYLE_ID = "unbound-simple-shell-v101";
const SIMPLE_SHELL_SCRIPT_ID = "unbound-simple-shell-runtime-v101";

const SIMPLE_SHELL_STYLES = `<style id="${SIMPLE_SHELL_STYLE_ID}">
.desktop-tools-button,
.desktop-simple-actions,
.simple-shell-panel {
  display: none;
}

@media (min-width: 761px) {
  .desktop-tools-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: 8px 13px;
    border: 1px solid rgba(107, 193, 255, 0.30);
    border-radius: 11px;
    background: rgba(66, 165, 255, 0.08);
    color: #e7f5ff;
    cursor: pointer;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: .055em;
  }

  .desktop-tools-button:hover,
  .desktop-chat-options-button:hover {
    border-color: rgba(107, 193, 255, 0.62);
    background: rgba(66, 165, 255, 0.16);
  }

  .desktop-simple-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-left: auto;
  }

  .desktop-simple-actions .new-chat,
  .desktop-chat-options-button {
    min-height: 40px;
    padding: 8px 12px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: .045em;
  }

  .desktop-chat-options-button {
    border: 1px solid rgba(255, 173, 67, 0.38);
    background: rgba(255, 173, 67, 0.08);
    color: #ffd297;
    cursor: pointer;
  }

  .desktop-mode-summary {
    flex: 1 0 100%;
    color: #9fc9e8;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .035em;
    text-align: right;
  }

  .chat-head > .chat-actions {
    display: none !important;
  }

  .user-pill[data-simple-account-trigger="true"] {
    cursor: pointer;
  }

  .user-pill[data-simple-account-trigger="true"]::after {
    content: "⌄";
    margin-left: 2px;
    color: #8fb7d2;
    font-size: 11px;
  }

  .simple-shell-panel {
    position: fixed;
    z-index: 130;
    display: none;
    width: min(390px, calc(100vw - 28px));
    max-height: min(72vh, 680px);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    -webkit-overflow-scrolling: touch;
    padding: 14px;
    border: 1px solid rgba(107, 193, 255, 0.38);
    border-radius: 16px;
    background: rgba(4, 10, 21, 0.985);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.68);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .simple-shell-panel[data-open="true"] {
    display: block;
  }

  .simple-shell-panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .simple-shell-panel-title {
    margin: 0;
    color: #ffffff;
    font-size: 16px;
    font-weight: 900;
  }

  .simple-shell-panel-copy {
    margin: 4px 0 0;
    color: #91a6ba;
    font-size: 11px;
    line-height: 1.45;
  }

  .simple-shell-close {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 10px;
    background: rgba(255,255,255,.04);
    color: #e8f5ff;
    cursor: pointer;
    font-size: 20px;
  }

  .simple-option-block + .simple-option-block {
    margin-top: 12px;
  }

  .simple-option-label {
    margin: 0 0 6px;
    color: #9fc9e8;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: .10em;
    text-transform: uppercase;
  }

  .simple-chat-controls .product-control,
  .simple-chat-controls .depth-control,
  .simple-chat-controls .style-control {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  .simple-chat-controls .product-control {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    padding: 6px;
  }

  .simple-chat-controls .product-button,
  .simple-chat-controls .depth-button {
    min-height: 42px;
    text-align: center;
  }

  .simple-chat-controls .depth-control {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .simple-chat-controls .style-control {
    display: flex;
    min-height: 44px;
    padding: 7px 10px;
  }

  .simple-chat-controls .style-control select {
    flex: 1 1 auto;
    width: 100%;
    max-width: none;
    min-height: 32px;
  }

  .simple-chat-controls .age {
    display: block !important;
    width: 100%;
    text-align: center;
  }

  .simple-tools-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .simple-tool-link {
    display: block;
    min-width: 0;
    padding: 11px;
    border: 1px solid rgba(107, 193, 255, 0.20);
    border-radius: 12px;
    background: rgba(66, 165, 255, 0.05);
    color: #eef8ff;
    text-decoration: none;
  }

  .simple-tool-link:hover {
    border-color: rgba(107, 193, 255, 0.50);
    background: rgba(66, 165, 255, 0.12);
  }

  .simple-tool-name {
    font-size: 12px;
    font-weight: 900;
  }

  .simple-tool-copy {
    margin-top: 3px;
    color: #8fa5b9;
    font-size: 9px;
    line-height: 1.35;
  }

  .simple-account-actions {
    display: grid;
    gap: 8px;
  }

  .simple-account-actions .account-button,
  .simple-account-actions .logout-button {
    width: 100%;
    min-height: 42px;
    justify-content: center;
  }
}

@media (max-width: 760px) {
  .simple-mobile-tools {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }

  .simple-mobile-tools .simple-tool-link {
    display: block;
    min-width: 0;
    min-height: 56px;
    padding: 9px 10px;
    border: 1px solid rgba(107, 193, 255, 0.20);
    border-radius: 11px;
    background: rgba(66, 165, 255, 0.05);
    color: #eef8ff;
    text-decoration: none;
  }

  .simple-mobile-tools .simple-tool-name {
    font-size: 10px;
    font-weight: 900;
  }

  .simple-mobile-tools .simple-tool-copy {
    margin-top: 2px;
    color: #8fa5b9;
    font-size: 8px;
    line-height: 1.3;
  }
}
</style>`;

const SIMPLE_SHELL_SCRIPT = `<script id="${SIMPLE_SHELL_SCRIPT_ID}">
(() => {
  const DESKTOP_QUERY = "(min-width: 761px)";
  const TOOL_LINKS = [
    ["Voice", "/voice.html", "Talk and listen hands-free"],
    ["Files", "/files.html", "Upload, read, and analyze files"],
    ["Images", "/images.html", "Create and understand images"],
    ["Tasks", "/tasks.html", "Scheduled and recurring work"],
    ["Connected Apps", "/connected-apps.html", "Work with linked services"],
    ["Memory", "/memory.html", "Review AI memory controls"],
    ["Agents", "/agents.html", "Run multi-step AI work"],
    ["More Modes", "/modes.html", "Explore specialized modes"]
  ];

  let initialized = false;
  let toolsPanel = null;
  let chatPanel = null;
  let accountPanel = null;
  let simpleActions = null;
  let chatControls = null;

  function titleCase(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/(^|[\\s_-])([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
  }

  function currentModeText() {
    const product = document.querySelector(".product-button.active");
    const depth = document.querySelector(".depth-button.active");
    const style = document.getElementById("aiStyleSelect");
    const productName = product ? titleCase(product.dataset.productMode || product.textContent) : "Standard";
    const depthName = depth ? titleCase(depth.dataset.depthStyle || depth.textContent) : "Casual";
    const styleName = style ? titleCase(style.value) : "Balanced";
    return productName + " • " + depthName + " • " + styleName;
  }

  function syncSummaries() {
    const desktopSummary = document.getElementById("desktopModeSummary");
    if (desktopSummary) desktopSummary.textContent = "Current: " + currentModeText();
    const mobileSummary = document.getElementById("mobileModeSummary");
    if (mobileSummary) mobileSummary.textContent = "Current: " + currentModeText();
  }

  function createToolLinks(container, mobile) {
    if (!container || container.dataset.simpleToolsReady === "true") return;
    container.dataset.simpleToolsReady = "true";
    const grid = document.createElement("div");
    grid.className = mobile ? "simple-mobile-tools" : "simple-tools-grid";

    TOOL_LINKS.forEach(([name, href, copy]) => {
      const link = document.createElement("a");
      link.className = "simple-tool-link";
      link.href = href;
      link.innerHTML = '<div class="simple-tool-name"></div><div class="simple-tool-copy"></div>';
      link.querySelector(".simple-tool-name").textContent = name;
      link.querySelector(".simple-tool-copy").textContent = copy;
      grid.appendChild(link);
    });

    container.appendChild(grid);
  }

  function makePanel(id, title, copy) {
    const panel = document.createElement("section");
    panel.id = id;
    panel.className = "simple-shell-panel";
    panel.dataset.open = "false";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", title);

    const head = document.createElement("div");
    head.className = "simple-shell-panel-head";
    const headCopy = document.createElement("div");
    const heading = document.createElement("h2");
    heading.className = "simple-shell-panel-title";
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.className = "simple-shell-panel-copy";
    paragraph.textContent = copy;
    headCopy.append(heading, paragraph);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "simple-shell-close";
    close.setAttribute("aria-label", "Close " + title);
    close.textContent = "×";
    close.addEventListener("click", closePanels);

    head.append(headCopy, close);
    panel.appendChild(head);
    document.body.appendChild(panel);
    return panel;
  }

  function closePanels() {
    [toolsPanel, chatPanel, accountPanel].forEach((panel) => {
      if (panel) {
        panel.dataset.open = "false";
        panel.style.maxHeight = "";
      }
    });
    document.querySelectorAll("[data-simple-panel-trigger]").forEach((trigger) => {
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  function positionPanel(panel, trigger) {
    if (!panel || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 320);
    const viewportHeight = Math.max(320, window.innerHeight || document.documentElement.clientHeight || 320);
    const edge = 14;
    const gap = 8;
    const width = Math.min(390, viewportWidth - edge * 2);

    let left = rect.right - width;
    left = Math.max(edge, Math.min(left, viewportWidth - width - edge));

    let top = Math.max(edge, rect.bottom + gap);
    const minimumVisibleHeight = Math.min(260, Math.max(180, viewportHeight - edge * 2));
    if (viewportHeight - top - edge < minimumVisibleHeight) {
      top = Math.max(edge, viewportHeight - minimumVisibleHeight - edge);
    }

    const availableHeight = Math.max(
      160,
      Math.min(680, viewportHeight - top - edge)
    );

    panel.style.left = left + "px";
    panel.style.top = top + "px";
    panel.style.maxHeight = availableHeight + "px";
    panel.style.overflowY = "auto";
  }

  function openPanel(panel, trigger) {
    if (!window.matchMedia(DESKTOP_QUERY).matches || !panel || !trigger) return;
    const willOpen = panel.dataset.open !== "true";
    closePanels();
    if (!willOpen) return;
    positionPanel(panel, trigger);
    panel.dataset.open = "true";
    trigger.setAttribute("aria-expanded", "true");
  }

  function buildDesktopShell() {
    const topbarRight = document.querySelector(".topbar-right");
    const chatHead = document.querySelector(".chat-head");
    const chatActions = document.querySelector(".chat-actions");
    if (!topbarRight || !chatHead || !chatActions) return;

    const toolsButton = document.createElement("button");
    toolsButton.type = "button";
    toolsButton.className = "desktop-tools-button";
    toolsButton.id = "desktopToolsButton";
    toolsButton.textContent = "TOOLS";
    toolsButton.dataset.simplePanelTrigger = "tools";
    toolsButton.setAttribute("aria-expanded", "false");
    toolsButton.setAttribute("aria-controls", "simpleToolsPanel");
    topbarRight.insertBefore(toolsButton, topbarRight.firstChild);

    toolsPanel = makePanel("simpleToolsPanel", "Tools", "Everything powerful stays available without crowding the main chat.");
    const toolsBody = document.createElement("div");
    toolsPanel.appendChild(toolsBody);
    createToolLinks(toolsBody, false);

    const advertiser = document.querySelector(".advertiser-link");
    if (advertiser) {
      advertiser.style.marginTop = "10px";
      toolsBody.appendChild(advertiser);
    }

    chatPanel = makePanel("simpleChatPanel", "Chat Options", "Change how UNBOUND answers. You can ignore these and just start typing.");
    chatControls = document.createElement("div");
    chatControls.className = "simple-chat-controls";
    chatPanel.appendChild(chatControls);

    const productControl = chatActions.querySelector(".product-control");
    const depthControl = chatActions.querySelector(".depth-control");
    const styleControl = chatActions.querySelector(".style-control");
    const ageBadge = chatActions.querySelector(".age");

    [
      ["Mode", productControl],
      ["Answer depth", depthControl],
      ["Conversation style", styleControl],
      ["Platform", ageBadge]
    ].forEach(([label, control]) => {
      if (!control) return;
      const block = document.createElement("div");
      block.className = "simple-option-block";
      const heading = document.createElement("div");
      heading.className = "simple-option-label";
      heading.textContent = label;
      block.append(heading, control);
      chatControls.appendChild(block);
    });

    simpleActions = document.createElement("div");
    simpleActions.className = "desktop-simple-actions";
    simpleActions.id = "desktopSimpleActions";

    const modeSummary = document.createElement("div");
    modeSummary.className = "desktop-mode-summary";
    modeSummary.id = "desktopModeSummary";
    simpleActions.appendChild(modeSummary);

    const historyButton = document.getElementById("historyButton");
    const newChatButton = document.getElementById("newChatButton");
    if (historyButton) simpleActions.appendChild(historyButton);
    if (newChatButton) simpleActions.appendChild(newChatButton);

    const chatOptionsButton = document.createElement("button");
    chatOptionsButton.type = "button";
    chatOptionsButton.className = "desktop-chat-options-button";
    chatOptionsButton.id = "desktopChatOptionsButton";
    chatOptionsButton.textContent = "CHAT OPTIONS";
    chatOptionsButton.dataset.simplePanelTrigger = "chat";
    chatOptionsButton.setAttribute("aria-expanded", "false");
    chatOptionsButton.setAttribute("aria-controls", chatPanel.id);
    simpleActions.appendChild(chatOptionsButton);

    chatHead.appendChild(simpleActions);

    accountPanel = makePanel("simpleAccountPanel", "Account", "Account access, security, and sign-out controls.");
    const accountActions = document.createElement("div");
    accountActions.className = "simple-account-actions";
    accountPanel.appendChild(accountActions);

    const signedInActions = document.getElementById("signedInActions");
    const userPill = signedInActions ? signedInActions.querySelector(".user-pill") : null;
    if (userPill) {
      userPill.dataset.simpleAccountTrigger = "true";
      userPill.dataset.simplePanelTrigger = "account";
      userPill.setAttribute("role", "button");
      userPill.setAttribute("tabindex", "0");
      userPill.setAttribute("aria-expanded", "false");
      userPill.setAttribute("aria-controls", accountPanel.id);
      userPill.setAttribute("aria-label", "Open account menu");
    }

    ["accessButton", "adminButton", "securityButton", "deleteAccountButton", "logoutButton"].forEach((id) => {
      const control = document.getElementById(id);
      if (control) accountActions.appendChild(control);
    });

    toolsButton.addEventListener("click", () => openPanel(toolsPanel, toolsButton));
    chatOptionsButton.addEventListener("click", () => openPanel(chatPanel, chatOptionsButton));
    if (userPill) {
      userPill.addEventListener("click", () => openPanel(accountPanel, userPill));
      userPill.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPanel(accountPanel, userPill);
        }
      });
    }

    document.addEventListener("click", (event) => {
      const open = [toolsPanel, chatPanel, accountPanel].find((panel) => panel && panel.dataset.open === "true");
      if (!open) return;
      if (open.contains(event.target)) return;
      const trigger = event.target.closest("[data-simple-panel-trigger]");
      if (trigger) return;
      closePanels();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanels();
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest(".product-button, .depth-button")) {
        window.setTimeout(syncSummaries, 0);
      }
    });
    const styleSelect = document.getElementById("aiStyleSelect");
    if (styleSelect) styleSelect.addEventListener("change", syncSummaries);
  }

  function enhanceMobileMenu() {
    const panel = document.getElementById("mobileMenuPanel");
    const chatSection = document.getElementById("mobileMenuChat");
    if (!panel || !chatSection || document.getElementById("simpleMobileToolsSection")) return;

    const section = document.createElement("div");
    section.className = "mobile-menu-section";
    section.id = "simpleMobileToolsSection";
    const title = document.createElement("div");
    title.className = "mobile-menu-title";
    title.textContent = "Tools";
    section.appendChild(title);
    createToolLinks(section, true);
    panel.insertBefore(section, chatSection);
  }

  function applyDesktopPlacement() {
    if (!window.matchMedia(DESKTOP_QUERY).matches) {
      closePanels();
      enhanceMobileMenu();
      syncSummaries();
      return;
    }

    const chatActions = document.querySelector(".chat-actions");
    if (chatControls && chatActions) {
      [".product-control", ".depth-control", ".style-control", ".age"].forEach((selector) => {
        const control = document.querySelector(selector);
        if (!control) return;
        const label = selector === ".product-control" ? "Mode" : selector === ".depth-control" ? "Answer depth" : selector === ".style-control" ? "Conversation style" : "Platform";
        let block = Array.from(chatControls.querySelectorAll(".simple-option-block")).find((candidate) => candidate.querySelector(".simple-option-label")?.textContent === label);
        if (!block) {
          block = document.createElement("div");
          block.className = "simple-option-block";
          const heading = document.createElement("div");
          heading.className = "simple-option-label";
          heading.textContent = label;
          block.appendChild(heading);
          chatControls.appendChild(block);
        }
        block.appendChild(control);
      });
    }

    if (simpleActions) {
      const historyButton = document.getElementById("historyButton");
      const newChatButton = document.getElementById("newChatButton");
      const chatOptionsButton = document.getElementById("desktopChatOptionsButton");
      if (historyButton) simpleActions.insertBefore(historyButton, chatOptionsButton);
      if (newChatButton) simpleActions.insertBefore(newChatButton, chatOptionsButton);
    }

    const advertiser = document.querySelector(".advertiser-link");
    const toolsBody = toolsPanel ? toolsPanel.lastElementChild : null;
    if (advertiser && toolsBody) toolsBody.appendChild(advertiser);

    const accountActions = accountPanel ? accountPanel.querySelector(".simple-account-actions") : null;
    if (accountActions) {
      ["accessButton", "adminButton", "securityButton", "deleteAccountButton", "logoutButton"].forEach((id) => {
        const control = document.getElementById(id);
        if (control) accountActions.appendChild(control);
      });
    }

    syncSummaries();
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    buildDesktopShell();
    enhanceMobileMenu();
    applyDesktopPlacement();
    window.addEventListener("resize", () => {
      closePanels();
      window.setTimeout(applyDesktopPlacement, 0);
    }, { passive: true });
  }

  window.addEventListener("DOMContentLoaded", initialize);
})();
</script>`;

function injectSimpleShell(html) {
  const source = String(html || "");
  if (source.includes(`id="${SIMPLE_SHELL_STYLE_ID}"`) || source.includes(`id="${SIMPLE_SHELL_SCRIPT_ID}"`)) {
    return source;
  }

  const headMarker = "</head>";
  const bodyMarker = "</body>";
  const headFirst = source.indexOf(headMarker);
  const headLast = source.lastIndexOf(headMarker);
  const bodyFirst = source.indexOf(bodyMarker);
  const bodyLast = source.lastIndexOf(bodyMarker);

  if (headFirst === -1 || headFirst !== headLast) {
    const error = new Error("UNBOUND AI simple shell head marker is missing or ambiguous.");
    error.code = "SIMPLE_SHELL_HEAD_MARKER_INVALID";
    throw error;
  }
  if (bodyFirst === -1 || bodyFirst !== bodyLast) {
    const error = new Error("UNBOUND AI simple shell body marker is missing or ambiguous.");
    error.code = "SIMPLE_SHELL_BODY_MARKER_INVALID";
    throw error;
  }

  const withStyles = source.slice(0, headFirst) + `  ${SIMPLE_SHELL_STYLES}\n` + source.slice(headFirst);
  const finalBodyIndex = withStyles.lastIndexOf(bodyMarker);
  return withStyles.slice(0, finalBodyIndex) + `  ${SIMPLE_SHELL_SCRIPT}\n` + withStyles.slice(finalBodyIndex);
}

module.exports = {
  SIMPLE_SHELL_STYLE_ID,
  SIMPLE_SHELL_SCRIPT_ID,
  SIMPLE_SHELL_STYLES,
  SIMPLE_SHELL_SCRIPT,
  injectSimpleShell
};