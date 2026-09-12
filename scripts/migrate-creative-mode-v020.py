from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    path.write_text(text.replace(old, new, 1))


def many(path, old, new, expected, label):
    text = path.read_text()
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'{label}: expected {expected} matches, found {count}')
    path.write_text(text.replace(old, new))


server = Path('app/server.js')
index = Path('app/index.html')
entitlements = Path('app/access/entitlements.js')

# Entitlement catalog: Creative is live and currently part of the baseline product.
one(
    entitlements,
'''  citations: Object.freeze({
    label: "Research citations",
    description: "Source citations and source metadata attached to Research Mode answers.",
    implemented: true,
    minimumPlan: "top"
  }),
  file_analysis: Object.freeze({
''',
'''  citations: Object.freeze({
    label: "Research citations",
    description: "Source citations and source metadata attached to Research Mode answers.",
    implemented: true,
    minimumPlan: "top"
  }),
  creative_mode: Object.freeze({
    label: "Creative Mode",
    description: "Idea generation, writing, brainstorming, worldbuilding, and creative collaboration.",
    implemented: true,
    minimumPlan: "free"
  }),
  file_analysis: Object.freeze({
''',
    'creative entitlement'
)

# Server prompt.
one(
    server,
'''const RESEARCH_MODE_PROMPT = `
Product mode: RESEARCH MODE.
- Use the provided web-search capability before answering.
- Prefer primary, official, recent, and directly relevant sources when they are available.
- Cross-check important or disputed claims across more than one source when practical.
- Clearly distinguish verified facts, uncertainty, estimates, and interpretation.
- Do not invent sources, citations, quotes, dates, or claims that were not supported by the research.
- Keep citations attached to the claims they support. The user interface will make cited URLs visible and clickable.
`;
''',
'''const RESEARCH_MODE_PROMPT = `
Product mode: RESEARCH MODE.
- Use the provided web-search capability before answering.
- Prefer primary, official, recent, and directly relevant sources when they are available.
- Cross-check important or disputed claims across more than one source when practical.
- Clearly distinguish verified facts, uncertainty, estimates, and interpretation.
- Do not invent sources, citations, quotes, dates, or claims that were not supported by the research.
- Keep citations attached to the claims they support. The user interface will make cited URLs visible and clickable.
`;

const CREATIVE_MODE_PROMPT = `
Product mode: CREATIVE MODE.
- Prioritize useful imagination, originality, and collaborative creation while following the user's requested format and constraints.
- Help with brainstorming, fiction, scripts, concepts, names, worldbuilding, marketing concepts, roleplay scenarios, and creative problem-solving.
- When the user asks for alternatives, produce meaningfully different options rather than superficial rewrites.
- Preserve continuity, characters, tone, facts, and constraints established in the conversation unless the user asks to change them.
- Do not present invented details as verified real-world facts. Clearly distinguish creative invention from factual claims when the boundary matters.
- Do not claim web research or source verification unless a real research capability was actually invoked.
`;
''',
    'creative mode prompt'
)

one(
    server,
'''function normalizeProductMode(value) {
  return String(value || "").trim().toLowerCase() === "research"
    ? "research"
    : "standard";
}
''',
'''function normalizeProductMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "research") return "research";
  if (normalized === "creative") return "creative";
  return "standard";
}
''',
    'server product mode normalization'
)

# Non-stream route capability and prompt.
one(
    server,
'''    if (productMode === "research") {
      await assertRequestCapability(req, "web_research");
      await assertRequestCapability(req, "citations");
    }

    const persistentChat = await preparePersistentChat(
''',
'''    if (productMode === "research") {
      await assertRequestCapability(req, "web_research");
      await assertRequestCapability(req, "citations");
    }
    if (productMode === "creative") {
      await assertOptionalAccountCapability(req, "creative_mode");
    }

    const persistentChat = await preparePersistentChat(
''',
    'creative non-stream capability'
)

one(
    server,
'''    const modeInstructions =
      productMode === "research" ? RESEARCH_MODE_PROMPT : "";
''',
'''    const modeInstructions =
      productMode === "research"
        ? RESEARCH_MODE_PROMPT
        : productMode === "creative"
          ? CREATIVE_MODE_PROMPT
          : "";
''',
    'creative non-stream instructions'
)

# Stream route capability and prompt.
one(
    server,
'''    await assertOptionalAccountCapability(req, "streaming");

    const persistentChat = await preparePersistentChat(
''',
'''    await assertOptionalAccountCapability(req, "streaming");
    if (productMode === "creative") {
      await assertOptionalAccountCapability(req, "creative_mode");
    }

    const persistentChat = await preparePersistentChat(
''',
    'creative stream capability'
)

one(
    server,
'''    const depthInstructions =
      depthStyle === "work" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;

    res.status(200);
''',
'''    const depthInstructions =
      depthStyle === "work" ? WORK_DEPTH_PROMPT : CASUAL_DEPTH_PROMPT;
    const modeInstructions =
      productMode === "creative" ? CREATIVE_MODE_PROMPT : "";

    res.status(200);
''',
    'creative stream instructions variable'
)

one(
    server,
'''      instructions: UNBOUND_SYSTEM_PROMPT + "\\n\\n" + depthInstructions,
''',
'''      instructions: [UNBOUND_SYSTEM_PROMPT, depthInstructions, modeInstructions]
        .filter(Boolean)
        .join("\\n\\n"),
''',
    'creative stream instructions use'
)

# Browser control button and active styling.
one(
    index,
'''            <button id="standardModeButton" class="product-button active" data-product-mode="standard" type="button" aria-pressed="true">STANDARD</button>
            <button id="researchModeButton" class="product-button" data-product-mode="research" type="button" aria-pressed="false">RESEARCH</button>
''',
'''            <button id="standardModeButton" class="product-button active" data-product-mode="standard" type="button" aria-pressed="true">STANDARD</button>
            <button id="creativeModeButton" class="product-button" data-product-mode="creative" type="button" aria-pressed="false">CREATIVE</button>
            <button id="researchModeButton" class="product-button" data-product-mode="research" type="button" aria-pressed="false">RESEARCH</button>
''',
    'creative product button'
)

one(
    index,
'''    .product-button.active[data-product-mode="research"] {
      background: rgba(162, 105, 255, 0.18);
      color: #e4d4ff;
      box-shadow: inset 0 0 0 1px rgba(188, 145, 255, 0.30);
    }
''',
'''    .product-button.active[data-product-mode="research"] {
      background: rgba(162, 105, 255, 0.18);
      color: #e4d4ff;
      box-shadow: inset 0 0 0 1px rgba(188, 145, 255, 0.30);
    }

    .product-button.active[data-product-mode="creative"] {
      background: rgba(255, 173, 67, 0.16);
      color: #ffe0b4;
      box-shadow: inset 0 0 0 1px rgba(255, 190, 105, 0.28);
    }
''',
    'creative button active style'
)

one(
    index,
'''    const standardModeButton = document.getElementById("standardModeButton");
    const researchModeButton = document.getElementById("researchModeButton");
''',
'''    const standardModeButton = document.getElementById("standardModeButton");
    const creativeModeButton = document.getElementById("creativeModeButton");
    const researchModeButton = document.getElementById("researchModeButton");
''',
    'creative DOM ref'
)

one(
    index,
'''    function normalizeProductMode(value) {
      return value === "research" ? "research" : "standard";
    }
''',
'''    function normalizeProductMode(value) {
      if (value === "research") return "research";
      if (value === "creative") return "creative";
      return "standard";
    }

    function productModeAllowedForCurrentAccount(value) {
      const normalized = normalizeProductMode(value);
      if (normalized === "research") {
        return Boolean(currentUser) && canUseCapability("web_research");
      }
      if (normalized === "creative" && currentUser) {
        return canUseCapability("creative_mode");
      }
      return true;
    }

    function safeProductMode(value) {
      const normalized = normalizeProductMode(value);
      return productModeAllowedForCurrentAccount(normalized) ? normalized : "standard";
    }
''',
    'creative browser normalization'
)

one(
    index,
'''    function renderProductMode() {
      const isResearch = productMode === "research";
      standardModeButton.classList.toggle("active", !isResearch);
      researchModeButton.classList.toggle("active", isResearch);
      standardModeButton.setAttribute("aria-pressed", isResearch ? "false" : "true");
      researchModeButton.setAttribute("aria-pressed", isResearch ? "true" : "false");
      productStatus.textContent = isResearch
        ? "Research Mode — Live web search + citations"
        : "Standard Mode";
    }
''',
'''    function renderProductMode() {
      const isResearch = productMode === "research";
      const isCreative = productMode === "creative";
      const isStandard = !isResearch && !isCreative;
      standardModeButton.classList.toggle("active", isStandard);
      creativeModeButton.classList.toggle("active", isCreative);
      researchModeButton.classList.toggle("active", isResearch);
      standardModeButton.setAttribute("aria-pressed", isStandard ? "true" : "false");
      creativeModeButton.setAttribute("aria-pressed", isCreative ? "true" : "false");
      researchModeButton.setAttribute("aria-pressed", isResearch ? "true" : "false");
      productStatus.textContent = isResearch
        ? "Research Mode — Live web search + citations"
        : isCreative
          ? "Creative Mode — Ideas, writing + worldbuilding"
          : "Standard Mode";
    }
''',
    'creative browser rendering'
)

one(
    index,
'''        showToast(
          productMode === "research"
            ? "Research Mode is active. Web search and citations will be used."
            : "Standard Mode is active."
        );
''',
'''        showToast(
          productMode === "research"
            ? "Research Mode is active. Web search and citations will be used."
            : productMode === "creative"
              ? "Creative Mode is active. UNBOUND will prioritize imaginative collaboration."
              : "Standard Mode is active."
        );
''',
    'creative mode toast'
)

# Account UI controls and locking.
one(
    index,
'''        const researchAllowed = canUseCapability("web_research");
        researchModeButton.classList.toggle("locked", !researchAllowed);
''',
'''        const creativeAllowed = canUseCapability("creative_mode");
        creativeModeButton.classList.toggle("locked", !creativeAllowed);
        creativeModeButton.setAttribute("aria-disabled", creativeAllowed ? "false" : "true");
        creativeModeButton.title = creativeAllowed ? "Creative Mode" : "Creative Mode is disabled for this account";
        const researchAllowed = canUseCapability("web_research");
        researchModeButton.classList.toggle("locked", !researchAllowed);
''',
    'creative signed-in access UI'
)

one(
    index,
'''      researchModeButton.classList.add("locked");
      researchModeButton.setAttribute("aria-disabled", "true");
''',
'''      creativeModeButton.classList.remove("locked");
      creativeModeButton.setAttribute("aria-disabled", "false");
      creativeModeButton.title = "Creative Mode";
      researchModeButton.classList.add("locked");
      researchModeButton.setAttribute("aria-disabled", "true");
''',
    'creative guest access UI'
)

# Conversation loading/scope uses central access sanitizer.
one(
    index,
'''      productMode = normalizeProductMode(
        data.conversation?.productMode || loadProductMode()
      );
      if (productMode === "research" && !canUseCapability("web_research")) {
        productMode = "standard";
      }
''',
'''      productMode = safeProductMode(
        data.conversation?.productMode || loadProductMode()
      );
''',
    'creative conversation load access'
)

one(
    index,
'''          productMode: canUseCapability("web_research") ? loadProductMode() : "standard"
''',
'''          productMode: safeProductMode(loadProductMode())
''',
    'creative legacy import mode'
)

one(
    index,
'''      productMode = loadProductMode();
      depthStyle = loadDepthStyle();
      if (productMode === "research" && !canUseCapability("web_research")) {
        productMode = "standard";
        saveProductMode();
      }
''',
'''      productMode = safeProductMode(loadProductMode());
      depthStyle = loadDepthStyle();
      saveProductMode();
''',
    'creative conversation scope access'
)

# Click behavior.
one(
    index,
'''    researchModeButton.addEventListener("click", chooseResearchMode);
''',
'''    creativeModeButton.addEventListener("click", () => {
      if (currentUser && !canUseCapability("creative_mode")) {
        showToast("Creative Mode is disabled for this account.");
        return;
      }
      setProductMode("creative", { announce: true });
    });
    researchModeButton.addEventListener("click", chooseResearchMode);
''',
    'creative click behavior'
)

# Streaming must carry Creative Mode through instead of hardcoding Standard.
one(
    index,
'''            productMode: "standard",
            conversationId: currentUser ? activeConversationId : null
''',
'''            productMode,
            conversationId: currentUser ? activeConversationId : null
''',
    'creative streaming request mode'
)

print('Applied UNBOUND AI Creative Mode v0.20 migrations.')
