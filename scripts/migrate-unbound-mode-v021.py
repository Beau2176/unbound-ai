from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {count}')
    path.write_text(text.replace(old, new, 1))


server = Path('app/server.js')
index = Path('app/index.html')
entitlements = Path('app/access/entitlements.js')

one(
    entitlements,
'''  creative_mode: Object.freeze({
    label: "Creative Mode",
    description: "Idea generation, writing, brainstorming, worldbuilding, and creative collaboration.",
    implemented: true,
    minimumPlan: "free"
  }),
  file_analysis: Object.freeze({
''',
'''  creative_mode: Object.freeze({
    label: "Creative Mode",
    description: "Idea generation, writing, brainstorming, worldbuilding, and creative collaboration.",
    implemented: true,
    minimumPlan: "free"
  }),
  unbound_mode: Object.freeze({
    label: "Unbound Mode",
    description: "Candid, direct conversation with fewer unnecessary caveats while retaining core safety boundaries.",
    implemented: true,
    minimumPlan: "free"
  }),
  file_analysis: Object.freeze({
''',
    'unbound entitlement'
)

one(
    server,
'''const CREATIVE_MODE_PROMPT = `
Product mode: CREATIVE MODE.
- Prioritize useful imagination, originality, and collaborative creation while following the user's requested format and constraints.
- Help with brainstorming, fiction, scripts, concepts, names, worldbuilding, marketing concepts, roleplay scenarios, and creative problem-solving.
- When the user asks for alternatives, produce meaningfully different options rather than superficial rewrites.
- Preserve continuity, characters, tone, facts, and constraints established in the conversation unless the user asks to change them.
- Do not present invented details as verified real-world facts. Clearly distinguish creative invention from factual claims when the boundary matters.
- Do not claim web research or source verification unless a real research capability was actually invoked.
`;
''',
'''const CREATIVE_MODE_PROMPT = `
Product mode: CREATIVE MODE.
- Prioritize useful imagination, originality, and collaborative creation while following the user's requested format and constraints.
- Help with brainstorming, fiction, scripts, concepts, names, worldbuilding, marketing concepts, roleplay scenarios, and creative problem-solving.
- When the user asks for alternatives, produce meaningfully different options rather than superficial rewrites.
- Preserve continuity, characters, tone, facts, and constraints established in the conversation unless the user asks to change them.
- Do not present invented details as verified real-world facts. Clearly distinguish creative invention from factual claims when the boundary matters.
- Do not claim web research or source verification unless a real research capability was actually invoked.
`;

const UNBOUND_MODE_PROMPT = `
Product mode: UNBOUND MODE.
- Be especially candid, direct, and natural. Answer the user's actual question instead of burying the answer under unnecessary caveats or boilerplate.
- Discuss mature, controversial, uncomfortable, or unconventional subjects frankly when they can be discussed safely.
- Match the user's preferred level of formality and language, including profanity when it naturally fits the conversation.
- Prefer useful substance over moralizing, lecturing, or needless repetition.
- Do not confuse candor with certainty: clearly state meaningful uncertainty, estimates, and factual limits.
- Keep the platform's core safety boundaries around serious illegal harm, exploitation, abuse, minors, trafficking, and non-consensual sexual content.
- Never claim tools, browsing, verification, or real-world actions that did not actually occur.
`;
''',
    'unbound mode prompt'
)

one(
    server,
'''  if (normalized === "research") return "research";
  if (normalized === "creative") return "creative";
  return "standard";
''',
'''  if (normalized === "research") return "research";
  if (normalized === "creative") return "creative";
  if (normalized === "unbound") return "unbound";
  return "standard";
''',
    'server unbound normalization'
)

one(
    server,
'''    if (productMode === "creative") {
      await assertOptionalAccountCapability(req, "creative_mode");
    }

    const persistentChat = await preparePersistentChat(
''',
'''    if (productMode === "creative") {
      await assertOptionalAccountCapability(req, "creative_mode");
    }
    if (productMode === "unbound") {
      await assertOptionalAccountCapability(req, "unbound_mode");
    }

    const persistentChat = await preparePersistentChat(
''',
    'unbound non-stream capability'
)

one(
    server,
'''        : productMode === "creative"
          ? CREATIVE_MODE_PROMPT
          : "";
''',
'''        : productMode === "creative"
          ? CREATIVE_MODE_PROMPT
          : productMode === "unbound"
            ? UNBOUND_MODE_PROMPT
            : "";
''',
    'unbound non-stream instructions'
)

one(
    server,
'''    if (productMode === "creative") {
      await assertOptionalAccountCapability(req, "creative_mode");
    }

    const persistentChat = await preparePersistentChat(
      req,
      message,
      depthStyle,
      productMode
    );
''',
'''    if (productMode === "creative") {
      await assertOptionalAccountCapability(req, "creative_mode");
    }
    if (productMode === "unbound") {
      await assertOptionalAccountCapability(req, "unbound_mode");
    }

    const persistentChat = await preparePersistentChat(
      req,
      message,
      depthStyle,
      productMode
    );
''',
    'unbound stream capability'
)

one(
    server,
'''    const modeInstructions =
      productMode === "creative" ? CREATIVE_MODE_PROMPT : "";
''',
'''    const modeInstructions =
      productMode === "creative"
        ? CREATIVE_MODE_PROMPT
        : productMode === "unbound"
          ? UNBOUND_MODE_PROMPT
          : "";
''',
    'unbound stream instructions'
)

# UI button and style.
one(
    index,
'''            <button id="standardModeButton" class="product-button active" data-product-mode="standard" type="button" aria-pressed="true">STANDARD</button>
            <button id="creativeModeButton" class="product-button" data-product-mode="creative" type="button" aria-pressed="false">CREATIVE</button>
''',
'''            <button id="standardModeButton" class="product-button active" data-product-mode="standard" type="button" aria-pressed="true">STANDARD</button>
            <button id="unboundModeButton" class="product-button" data-product-mode="unbound" type="button" aria-pressed="false">UNBOUND</button>
            <button id="creativeModeButton" class="product-button" data-product-mode="creative" type="button" aria-pressed="false">CREATIVE</button>
''',
    'unbound product button'
)

one(
    index,
'''    .product-button.active[data-product-mode="creative"] {
      background: rgba(255, 173, 67, 0.16);
      color: #ffe0b4;
      box-shadow: inset 0 0 0 1px rgba(255, 190, 105, 0.28);
    }
''',
'''    .product-button.active[data-product-mode="creative"] {
      background: rgba(255, 173, 67, 0.16);
      color: #ffe0b4;
      box-shadow: inset 0 0 0 1px rgba(255, 190, 105, 0.28);
    }

    .product-button.active[data-product-mode="unbound"] {
      background: rgba(101, 232, 164, 0.15);
      color: #b8ffd8;
      box-shadow: inset 0 0 0 1px rgba(101, 232, 164, 0.28);
    }
''',
    'unbound active style'
)

one(
    index,
'''    const standardModeButton = document.getElementById("standardModeButton");
    const creativeModeButton = document.getElementById("creativeModeButton");
''',
'''    const standardModeButton = document.getElementById("standardModeButton");
    const unboundModeButton = document.getElementById("unboundModeButton");
    const creativeModeButton = document.getElementById("creativeModeButton");
''',
    'unbound DOM ref'
)

one(
    index,
'''      if (value === "research") return "research";
      if (value === "creative") return "creative";
      return "standard";
''',
'''      if (value === "research") return "research";
      if (value === "creative") return "creative";
      if (value === "unbound") return "unbound";
      return "standard";
''',
    'unbound browser normalization'
)

one(
    index,
'''      if (normalized === "creative" && currentUser) {
        return canUseCapability("creative_mode");
      }
      return true;
''',
'''      if (normalized === "creative" && currentUser) {
        return canUseCapability("creative_mode");
      }
      if (normalized === "unbound" && currentUser) {
        return canUseCapability("unbound_mode");
      }
      return true;
''',
    'unbound account access normalization'
)

one(
    index,
'''      const isResearch = productMode === "research";
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
''',
'''      const isResearch = productMode === "research";
      const isCreative = productMode === "creative";
      const isUnbound = productMode === "unbound";
      const isStandard = !isResearch && !isCreative && !isUnbound;
      standardModeButton.classList.toggle("active", isStandard);
      unboundModeButton.classList.toggle("active", isUnbound);
      creativeModeButton.classList.toggle("active", isCreative);
      researchModeButton.classList.toggle("active", isResearch);
      standardModeButton.setAttribute("aria-pressed", isStandard ? "true" : "false");
      unboundModeButton.setAttribute("aria-pressed", isUnbound ? "true" : "false");
      creativeModeButton.setAttribute("aria-pressed", isCreative ? "true" : "false");
      researchModeButton.setAttribute("aria-pressed", isResearch ? "true" : "false");
      productStatus.textContent = isResearch
        ? "Research Mode — Live web search + citations"
        : isCreative
          ? "Creative Mode — Ideas, writing + worldbuilding"
          : isUnbound
            ? "Unbound Mode — Candid, direct conversation"
            : "Standard Mode";
''',
    'unbound browser rendering'
)

one(
    index,
'''            : productMode === "creative"
              ? "Creative Mode is active. UNBOUND will prioritize imaginative collaboration."
              : "Standard Mode is active."
''',
'''            : productMode === "creative"
              ? "Creative Mode is active. UNBOUND will prioritize imaginative collaboration."
              : productMode === "unbound"
                ? "Unbound Mode is active. UNBOUND will be especially candid and direct."
                : "Standard Mode is active."
''',
    'unbound mode toast'
)

one(
    index,
'''        const creativeAllowed = canUseCapability("creative_mode");
''',
'''        const unboundAllowed = canUseCapability("unbound_mode");
        unboundModeButton.classList.toggle("locked", !unboundAllowed);
        unboundModeButton.setAttribute("aria-disabled", unboundAllowed ? "false" : "true");
        unboundModeButton.title = unboundAllowed ? "Unbound Mode" : "Unbound Mode is disabled for this account";
        const creativeAllowed = canUseCapability("creative_mode");
''',
    'unbound signed-in access UI'
)

one(
    index,
'''      creativeModeButton.classList.remove("locked");
''',
'''      unboundModeButton.classList.remove("locked");
      unboundModeButton.setAttribute("aria-disabled", "false");
      unboundModeButton.title = "Unbound Mode";
      creativeModeButton.classList.remove("locked");
''',
    'unbound guest access UI'
)

one(
    index,
'''    creativeModeButton.addEventListener("click", () => {
''',
'''    unboundModeButton.addEventListener("click", () => {
      if (currentUser && !canUseCapability("unbound_mode")) {
        showToast("Unbound Mode is disabled for this account.");
        return;
      }
      setProductMode("unbound", { announce: true });
    });
    creativeModeButton.addEventListener("click", () => {
''',
    'unbound click behavior'
)

print('Applied UNBOUND AI Unbound Mode v0.21 migrations.')
