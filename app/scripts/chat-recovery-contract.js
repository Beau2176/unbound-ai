const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  injectInterruptedStreamRecovery
} = require("../ui/chat-stream-recovery");

const rawSource = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const source = injectInterruptedStreamRecovery(rawSource);
assert.equal(
  injectInterruptedStreamRecovery(source),
  source,
  "interrupted-stream homepage integration must be idempotent"
);
assert.ok(source.includes("let streamCompleted = false;"));
assert.ok(source.includes("[Response interrupted before completion.]"));

const start = source.indexOf("    async function sendMessage() {");
const end = source.indexOf("    async function goDeeper()", start);
assert.ok(start >= 0 && end > start);

function browser(mode, fetch) {
  const c = {
    chatRequestPending: false,
    serviceWriteBlocked: false,
    currentUser: { id: "owner" },
    accountAccess: {},
    activeConversationId: "chat1",
    conversationHistory: [],
    productMode: mode,
    depthStyle: "casual",
    aiStyle: {},
    MAX_CONTEXT_MESSAGES: 20,
    input: { value: "unsent message", focus() {} },
    sendButton: {},
    goDeeperButton: {},
    messages: { scrollTop: 0, scrollHeight: 0 },
    bubbles: [],
    saves: 0,
    addMessage(role, content) {
      const bubble = {
        role,
        content,
        innerHTML: content,
        classes: [],
        classList: {
          add(value) {
            bubble.classes.push(value);
          }
        },
        remove() {
          bubble.removed = true;
        }
      };
      c.bubbles.push(bubble);
      return bubble;
    },
    saveConversation() {
      c.saves += 1;
    },
    updateGoDeeperVisibility() {},
    addTypingIndicator() {
      return { remove() {} };
    },
    renderAccountUi() {},
    renderConversation() {},
    renderMarkdown: (text) => text,
    openAuth(modeValue) {
      c.authMode = modeValue;
    },
    showAuthFeedback(message) {
      c.feedback = message;
    },
    readJson: (response) => response.json(),
    fetch,
    TextDecoder,
    Uint8Array,
    console
  };
  vm.createContext(c);
  vm.runInContext(source.slice(start, end), c);
  return c;
}

function streamResponse(events) {
  const chunks = events.map((event) =>
    Uint8Array.from(Buffer.from(`${JSON.stringify(event)}\n`, "utf8"))
  );
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (index < chunks.length) {
              return { value: chunks[index++], done: false };
            }
            return { value: undefined, done: true };
          }
        };
      }
    }
  };
}

async function main() {
  for (const mode of ["chat", "research"]) {
    let release;
    let calls = 0;
    const response = new Promise((resolve) => {
      release = resolve;
    });
    const c = browser(mode, () => {
      calls += 1;
      return response;
    });
    const first = c.sendMessage();
    c.input.value = "new draft";
    await c.sendMessage();
    assert.equal(calls, 1, "duplicate send must not make a request");
    release({ ok: false, status: 401, json: async () => ({ error: "Expired" }) });
    await first;
    assert.equal(c.input.value, "unsent message\n\nnew draft");
    assert.equal(c.authMode, "login");
    assert.equal(c.currentUser, null);
    assert.equal(c.activeConversationId, null);
    assert.equal(c.conversationHistory.length, 0);
    assert.equal(c.chatRequestPending, false);
    assert.equal(c.sendButton.disabled, false);
  }

  const research = browser("research", async () => ({
    ok: true,
    json: async () => ({ reply: "Answer", conversationId: "chat1" })
  }));
  await research.sendMessage();
  assert.equal(research.conversationHistory[1].content, "Answer");
  assert.equal(research.authMode, undefined);
  assert.equal(research.chatRequestPending, false);

  const complete = browser("chat", async () =>
    streamResponse([
      { type: "meta", conversationId: "chat1" },
      { type: "delta", delta: "Complete answer" },
      { type: "done", conversationId: "chat1" }
    ])
  );
  await complete.sendMessage();
  assert.equal(complete.conversationHistory.length, 2);
  assert.equal(complete.conversationHistory[1].content, "Complete answer");
  assert.notEqual(complete.conversationHistory[1].interrupted, true);

  const interrupted = browser("chat", async () =>
    streamResponse([
      { type: "meta", conversationId: "chat1" },
      { type: "delta", delta: "Partial answer" }
    ])
  );
  await interrupted.sendMessage();
  assert.equal(interrupted.conversationHistory.length, 2);
  assert.equal(interrupted.conversationHistory[1].interrupted, true);
  assert.equal(
    interrupted.conversationHistory[1].content,
    "Partial answer\n\n[Response interrupted before completion.]"
  );
  assert.ok(
    interrupted.bubbles[interrupted.bubbles.length - 1].classes.includes("error"),
    "interrupted partial response must stay visibly marked as an error"
  );
  assert.equal(interrupted.chatRequestPending, false);

  console.log(
    "PASS chat recovery: duplicate submissions blocked; session-expiry drafts restored; successful replies preserved; clean early EOF is marked interrupted."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
