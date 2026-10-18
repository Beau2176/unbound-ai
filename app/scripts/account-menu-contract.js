const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { SIMPLE_SHELL_SCRIPT } = require("../ui/simple-shell");
const { MOBILE_LAYOUT_SCRIPT } = require("../ui/mobile-layout");

const index = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const accountIds = ["accessButton", "adminButton", "securityButton", "deleteAccountButton", "logoutButton"];

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing production section: ${start}`);
  return source.slice(from, to);
}

// Only tree ownership and hidden state are modeled; all placement and account
// visibility decisions below execute the production scripts, not test copies.
function fixture(desktop) {
  const nodes = new Map();
  const node = (id = "", classes = "") => {
    const value = {
      id, className: classes, children: [], parentNode: null, hidden: false,
      dataset: {}, attributes: {}, style: {}, textContent: "",
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(key, text) { this.attributes[key] = text; },
      addEventListener() {},
      append(...children) { children.forEach((child) => this.appendChild(child)); },
      appendChild(child) { return this.insertBefore(child, null); },
      insertBefore(child, before) {
        if (child === before) return child;
        if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
        const position = before ? this.children.indexOf(before) : this.children.length;
        assert.ok(position >= 0, "Reference child must belong to its parent.");
        this.children.splice(position, 0, child);
        child.parentNode = this;
        return child;
      },
      querySelector(selector) {
        const matches = (child) => selector.startsWith(".") && child.className.split(" ").includes(selector.slice(1));
        for (const child of this.children) {
          if (matches(child)) return child;
          const nested = child.querySelector(selector);
          if (nested) return nested;
        }
        return null;
      },
      querySelectorAll(selector) {
        return this.children.filter((child) => selector.startsWith(".") && child.className.split(" ").includes(selector.slice(1)));
      },
      get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; },
      get firstChild() { return this.children[0] || null; },
      get lastElementChild() { return this.children.at(-1) || null; }
    };
    if (id) nodes.set(id, value);
    return value;
  };
  const body = node("body");
  const topbar = node("topbar", "topbar-right");
  const signedOut = node("signedOutActions");
  const signedIn = node("signedInActions");
  const nav = node("mobileMenuNav");
  const chatHead = node("chatHead", "chat-head");
  const chatActions = node("chatActions", "chat-actions");
  body.append(topbar, nav, chatHead);
  topbar.append(signedOut, signedIn);
  chatHead.appendChild(chatActions);
  signedIn.appendChild(node("userPill", "user-pill"));
  signedOut.append(node("signInButton"), node("createAccountButton"));
  accountIds.forEach((id) => signedIn.appendChild(node(id)));
  ["historyButton", "newChatButton"].forEach((id) => chatActions.appendChild(node(id)));

  const context = vm.createContext({
    document: {
      body, createElement: () => node(), createComment: () => node(),
      getElementById: (id) => nodes.get(id) || findById(body, id),
      querySelector: (selector) => body.querySelector(selector), addEventListener() {}
    },
    window: { matchMedia: () => ({ matches: context.desktop }), addEventListener() {}, setTimeout: (run) => run() },
    desktop, DESKTOP_QUERY: "(min-width: 761px)", moved: [],
    toolsPanel: null, chatPanel: null, accountPanel: null, chatControls: null, simpleActions: null,
    createToolLinks() {}, enhanceMobileMenu() {}, syncSummaries() {}, closePanels() {}, openPanel() {},
    makePanel(id) { const panel = node(id); body.appendChild(panel); return panel; }
  });
  function findById(root, id) {
    if (root.id === id) return root;
    for (const child of root.children) { const match = findById(child, id); if (match) return match; }
    return null;
  }
  const get = context.document.getElementById;
  vm.runInContext(
    section(MOBILE_LAYOUT_SCRIPT, "  function rememberAndMove(", "  function setMenuTop(") +
    section(SIMPLE_SHELL_SCRIPT, "  function buildDesktopShell()", "  function enhanceMobileMenu()") +
    section(SIMPLE_SHELL_SCRIPT, "  function applyDesktopPlacement()", "  function initialize()"), context
  );
  // This is the real order: mobile layout records the original parents first;
  // then the desktop shell initializes, even on a phone.
  for (const id of [...accountIds, "createAccountButton"]) {
    get(id).dataset.unboundMobileTarget = nav.id;
    context.rememberAndMove(get(id), nav);
  }
  if (desktop) context.restoreAll();
  context.buildDesktopShell();
  context.applyDesktopPlacement();
  return { context, get, nav, node };
}

function checkPlacement() {
  for (const initiallyDesktop of [false, true]) {
    const { context, get, nav } = fixture(initiallyDesktop);
    const security = get("securityButton");
    const handler = () => {};
    security.onclick = handler;
    const initialParent = initiallyDesktop ? get("simpleAccountPanel").querySelector(".simple-account-actions") : nav;
    assert.ok(security.parentNode === initialParent, "Security must be reachable immediately after the phone page initializes.");
    for (const desktop of [initiallyDesktop, !initiallyDesktop, initiallyDesktop, false, true, false]) {
      context.desktop = desktop;
      if (desktop) context.restoreAll(); else context.moveRemembered();
      context.applyDesktopPlacement();
      const parent = desktop ? get("simpleAccountPanel").querySelector(".simple-account-actions") : nav;
      for (const id of accountIds) {
        assert.ok(get(id).parentNode === parent,
          `${id} must remain reachable in the ${desktop ? "desktop account" : "phone"} menu.`);
      }
      assert.ok(get("securityButton") === security, "Preserve the original Security button.");
      assert.strictEqual(security.onclick, handler, "Moving Security must preserve its handler.");
      assert.strictEqual(nav.children.filter((child) => child.id === "securityButton").length, desktop ? 0 : 1);
    }
  }
}

function checkAccountVisibility() {
  const { context, get, node } = fixture(false);
  for (const id of ["userAvatar", "userName", "userPlan", "unboundModeButton", "adultModeButton", "creativeModeButton", "researchModeButton"]) node(id);
  for (const id of ["signedOutActions", "signedInActions", "createAccountButton", ...accountIds,
    "userAvatar", "userName", "userPlan", "historyButton", "unboundModeButton", "adultModeButton", "creativeModeButton", "researchModeButton"]) context[id] = get(id);
  Object.assign(context, {
    currentUser: null, accountAccess: {}, initialsForUser: () => "SA", planLabelForUser: () => "ULTRA",
    canUseCapability: () => false, refreshSecurityAlertBadge: async () => {}, updateSecurityAlertBadge() {}
  });
  vm.runInContext(section(index, "    function renderAccountUi()", "    function openAuth("), context);
  for (const user of [{ role: "admin" }, null, { role: "user" }, null]) {
    context.currentUser = user;
    context.renderAccountUi();
    assert.strictEqual(get("securityButton").hidden, !user, "Security visibility must follow sign-in state.");
    assert.strictEqual(get("createAccountButton").hidden, Boolean(user), "Hide Create Account after it moves out of the signed-out container.");
    assert.strictEqual(get("logoutButton").hidden, !user, "Hide Log Out after sign-out, including in the phone menu.");
    assert.strictEqual(get("adminButton").hidden, user?.role !== "admin");
    assert.strictEqual(get("deleteAccountButton").hidden, !user || user.role === "admin");
  }
}

let failures = 0;
for (const check of [checkPlacement, checkAccountVisibility]) {
  try { check(); console.log(`PASS account menu: ${check.name}`); }
  catch (error) { failures += 1; console.error(`FAIL account menu: ${check.name}: ${error.message}`); }
}
if (failures) process.exitCode = 1;
