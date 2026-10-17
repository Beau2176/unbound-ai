const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const styles = require("../preferences/ai-style");
const { buildAiStyleBrowserFunctions, buildAiStyleIndexHtml } = require("../preferences/mode-ui");
const { integrateNativeShellServerSource } = require("../ui/native-shell-server-integration");

const appRoot = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
const server = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
}

async function checkChatRoutes() {
  const routes = new Map();
  const calls = [];
  const persisted = [];
  const capabilities = [];
  const context = vm.createContext({
    ...styles,
    console: { ...console, error() {} },
    app: { post: (route, ...handlers) => routes.set(route, handlers.at(-1)) },
    chatRateLimit() {}, researchRateLimit() {},
    databaseReady: false, pool: null,
    getGatewayStatus: () => ({ configured: true, research: true, model: "test-model" }),
    normalizeDepthStyle: (value) => value === "work" ? "work" : "casual",
    normalizeProductMode: (value) => value || "standard",
    assertOptionalAccountCapability: async (_req, key) => { capabilities.push(key); },
    assertRequestCapability: async () => {},
    assertAgeVerifiedAdult: async () => { throw Object.assign(new Error("Age verification required"), { statusCode: 403 }); },
    preparePersistentChat: async (req) => req.savedChat || null,
    resolveAiStyleForRequest: async (req, user) => styles.normalizeAiStyle(user ? req.savedStyle : req.body.aiStyle),
    cleanHistory: (history) => history || [],
    runWithRequestCancellation: async (_req, _res, run) => run(new AbortController().signal),
    handleCancelledAiResponse: () => false,
    persistAssistantMessage: async (...args) => { persisted.push(args); },
    writeNdjsonEvent: async (res, event) => { res.events.push(event); },
    generateChat: async (options) => {
      calls.push(options);
      return { reply: "A mocked conversational reply.", provider: "test", model: "test-model" };
    },
    streamChat: async (options) => {
      calls.push(options);
      await options.onDelta("A mocked conversational reply.");
      return { reply: "A mocked conversational reply.", provider: "test", model: "test-model" };
    }
  });
  vm.runInContext(
    [...server.matchAll(/const (?:UNBOUND_SYSTEM_PROMPT|CASUAL_DEPTH_PROMPT|WORK_DEPTH_PROMPT|RESEARCH_MODE_PROMPT|CREATIVE_MODE_PROMPT|UNBOUND_MODE_PROMPT|ADULT_MODE_PROMPT) = `[\s\S]*?`;/g)].map(([prompt]) => prompt).join("\n") +
      section(server, 'app.post("/api/chat",', 'app.get("/", (req, res) => {'),
    context
  );

  const response = () => ({
    statusCode: 200, events: [],
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {}, flushHeaders() {}, end() {}
  });
  const previous = { role: "user", content: "I used to take photographs." };
  for (const route of ["/api/chat", "/api/chat/stream"]) {
    for (const depthStyle of ["casual", "work"]) {
      const res = response();
      await routes.get(route)({
        body: { message: "The sunset reminded me of that.", aiStyle: "balanced", depthStyle, productMode: "standard" },
        savedStyle: "listener",
        savedChat: { user: { id: 1 }, conversationId: "saved-conversation", history: [previous] }
      }, res);
      assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
      const request = calls.at(-1);
      assert.ok(request.instructions.includes("User-selected UNBOUND AI mode: CONVERSATION."));
      assert.ok(request.instructions.includes("the user does not need to have a question or task"));
      assert.ok(request.instructions.includes("when the user asks for them"));
      assert.ok(!request.instructions.includes("give a concise, direct answer first"));
      assert.ok(!request.instructions.includes("Work through reasonable intermediate steps"));
      assert.strictEqual(request.input[0].content, previous.content);
      assert.strictEqual(request.input.at(-1).content, "The sunset reminded me of that.");
      assert.strictEqual(persisted.at(-1)[0].conversationId, "saved-conversation");
      assert.ok(capabilities.includes("chat"));
      assert.ok(capabilities.includes(depthStyle === "work" ? "work_mode" : "casual_mode"));
      if (route.endsWith("/stream")) {
        assert.strictEqual(res.events[0].aiStyle, "listener");
        assert.strictEqual(res.events.at(-1).type, "done");
      } else {
        assert.strictEqual(res.body.aiStyle, "listener");
      }
    }
    const voice = response();
    await routes.get(route)({
      body: { message: "I'd just like to talk.", productMode: "unbound", depthStyle: "casual" },
      savedStyle: "listener", savedChat: { user: { id: 1 }, history: [] }
    }, voice);
    assert.strictEqual(voice.statusCode, 200, JSON.stringify(voice.body));
    assert.ok(calls.at(-1).instructions.includes("User-selected UNBOUND AI mode: CONVERSATION."));
    assert.ok(calls.at(-1).instructions.includes("Product mode: UNBOUND MODE."));
    const denied = response();
    const before = calls.length;
    await routes.get(route)({ body: { message: "Hello", aiStyle: "listener", productMode: "adult" } }, denied);
    assert.strictEqual(denied.statusCode, 403);
    assert.strictEqual(calls.length, before, "Conversation must not bypass the existing adult gate.");
  }
  for (const mode of styles.listAiStyles().filter(({ id }) => id !== "listener")) {
    assert.strictEqual(styles.getAiStyleDepthPrompt(mode.id, "casual", "original casual prompt"), "original casual prompt");
    assert.strictEqual(styles.getAiStyleDepthPrompt(mode.id, "work", "original work prompt"), "original work prompt");
  }
}

function checkServedHomepage() {
  let handler;
  const integrated = integrateNativeShellServerSource('app.use("/api", createMaintenanceMiddleware());');
  vm.runInNewContext(integrated, {
    app: { get() {}, use(first) { if (typeof first === "function") handler = first; } },
    createMaintenanceMiddleware: () => () => {},
    require: createRequire(path.join(appRoot, "server.js")),
    __dirname: appRoot, path, console
  });
  assert.strictEqual(integrateNativeShellServerSource(integrated), integrated);
  for (const route of ["/", "/index.html"]) {
    let html;
    handler({ path: route }, {
      setHeader() {}, type() {}, send(value) { html = value; }
    }, () => assert.fail("The real homepage must render successfully."));
    const select = html.match(/<select id="aiStyleSelect"[\s\S]*?<\/select>/)[0];
    assert.strictEqual((select.match(/<option value=/g) || []).length, 100);
    assert.ok(select.includes('<option value="listener">CONVERSATION</option>'));
    assert.ok(html.includes('id="conversationModeButton"'));
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) new vm.Script(match[1]);
    }
  }
}

async function checkModeControls() {
  const events = [];
  const saved = [];
  const element = () => ({
    value: "professional", textContent: "", disabled: false, attributes: {},
    classList: { toggle() {} },
    setAttribute(key, value) { this.attributes[key] = value; }
  });
  const button = element();
  const input = { focus() {}, placeholder: "" };
  const context = vm.createContext({
    console, aiStyle: "professional", aiStyleSaving: false, currentUser: { id: 1 },
    chatRequestPending: false, productMode: "research", depthStyle: "work", serviceWriteBlocked: false,
    conversationHistory: [{ role: "assistant", content: "Earlier reply" }],
    aiStyleSelect: element(), styleStatus: element(), conversationModeButton: button, input,
    casualModeButton: element(), workModeButton: element(), depthStatus: element(), goDeeperButton: element(),
    normalizeDepthStyle: (value) => value === "work" ? "work" : "casual",
    saveDepthStyle() {},
    setProductMode(value) { context.productMode = value; },
    saveAiStyleLocal() { saved.push(context.aiStyle); },
    loadAiStyle: () => "listener",
    showToast() {}, readJson: async (res) => res.body,
    CustomEvent: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent(event) { events.push(event.type); } },
    fetch: async (_url, options) => ({ ok: true, body: { preferences: { aiStyle: JSON.parse(options.body).aiStyle } } })
  });
  vm.runInContext(
    buildAiStyleBrowserFunctions() +
      section(index, "    function updateGoDeeperVisibility()", "    function aiStyleStorageKey()") +
      section(index, "    function renderAiStyle()", "    function normalizeHistory(items)"), context
  );
  await context.handleConversationModeClick();
  assert.strictEqual(context.aiStyle, "listener");
  assert.strictEqual(context.productMode, "standard");
  assert.strictEqual(context.depthStyle, "casual");
  assert.strictEqual(button.attributes["aria-pressed"], "true");
  assert.strictEqual(input.placeholder, "What's on your mind?");
  assert.strictEqual(context.goDeeperButton.hidden, true);
  assert.strictEqual(saved.at(-1), "listener");
  assert.ok(events.includes("unbound:ai-style-changed"));
  context.serviceWriteBlocked = true;
  context.renderMessagePlaceholder();
  assert.strictEqual(input.placeholder, "Chat temporarily paused...");
  context.serviceWriteBlocked = false;

  await context.handleConversationModeClick();
  assert.strictEqual(context.aiStyle, "balanced");
  assert.strictEqual(button.attributes["aria-pressed"], "false");
  assert.strictEqual(input.placeholder, "Message UNBOUND AI...");
  assert.strictEqual(context.goDeeperButton.hidden, false);

  context.productMode = "research";
  context.depthStyle = "work";
  context.fetch = async () => ({ ok: false, body: { error: "Save failed" } });
  const saveCount = saved.length;
  await context.handleConversationModeClick();
  assert.strictEqual(context.aiStyle, "balanced");
  assert.strictEqual(context.aiStyleSelect.value, "balanced");
  assert.strictEqual(context.productMode, "research");
  assert.strictEqual(context.depthStyle, "work");
  assert.strictEqual(saved.length, saveCount);
  assert.strictEqual(button.disabled, false);
  assert.strictEqual(context.aiStyleSelect.disabled, false);

  let finishSave;
  context.fetch = () => new Promise((resolve) => { finishSave = resolve; });
  const pending = context.handleConversationModeClick();
  assert.strictEqual(button.disabled, true);
  assert.strictEqual(context.aiStyleSaving, true);
  context.currentUser = { id: 2 };
  finishSave({ ok: true, body: { preferences: { aiStyle: "listener" } } });
  await pending;
  assert.strictEqual(context.aiStyle, "balanced", "A completed save from another account scope must not change the current mode.");
  assert.strictEqual(saved.length, saveCount);
  assert.strictEqual(button.disabled, false);

  context.fetch = async () => ({ ok: true, body: { preferences: { aiStyle: "listener" } } });
  await context.syncAiStyleForScope();
  assert.strictEqual(context.aiStyle, "listener", "Existing saved Listener accounts must open in Conversation mode.");
  context.currentUser = null;
  context.fetch = async () => assert.fail("Guest mode selection must stay local.");
  await context.handleConversationModeClick();
  assert.strictEqual(context.aiStyle, "balanced");
}

async function main() {
  assert.strictEqual(styles.getAiStyleDefinition("listener").label, "Conversation");
  assert.throws(() => buildAiStyleIndexHtml("<html></html>"), { code: "AI_STYLE_INDEX_MARKER_CHANGED" });
  await checkChatRoutes();
  checkServedHomepage();
  await checkModeControls();
  console.log("PASS Conversation mode: saved settings, exit and failed-save behavior, real homepage rendering, history, streaming, voice chat route, and existing mode gates (mock providers; no paid calls).");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
