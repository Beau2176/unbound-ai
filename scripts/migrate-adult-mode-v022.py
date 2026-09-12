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

# Capability catalog: Adult Mode is implemented, but server-side hard 18+ verification
# is an additional runtime gate and can keep it unusable even when the plan includes it.
one(
    entitlements,
'''  unbound_mode: Object.freeze({
    label: "Unbound Mode",
    description: "Candid, direct conversation with fewer unnecessary caveats while retaining core safety boundaries.",
    implemented: true,
    minimumPlan: "free"
  }),
  file_analysis: Object.freeze({
''',
'''  unbound_mode: Object.freeze({
    label: "Unbound Mode",
    description: "Candid, direct conversation with fewer unnecessary caveats while retaining core safety boundaries.",
    implemented: true,
    minimumPlan: "free"
  }),
  adult_mode: Object.freeze({
    label: "Adult Mode",
    description: "Verified-18+ mature conversation protected by a server-side hard age-verification gate.",
    implemented: true,
    minimumPlan: "free"
  }),
  file_analysis: Object.freeze({
''',
    'adult entitlement'
)

# Adult Mode prompt keeps the product's firm safety boundary while allowing candid
# lawful adult discussion after the server has verified age eligibility.
one(
    server,
'''const UNBOUND_MODE_PROMPT = `
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
'''const UNBOUND_MODE_PROMPT = `
Product mode: UNBOUND MODE.
- Be especially candid, direct, and natural. Answer the user's actual question instead of burying the answer under unnecessary caveats or boilerplate.
- Discuss mature, controversial, uncomfortable, or unconventional subjects frankly when they can be discussed safely.
- Match the user's preferred level of formality and language, including profanity when it naturally fits the conversation.
- Prefer useful substance over moralizing, lecturing, or needless repetition.
- Do not confuse candor with certainty: clearly state meaningful uncertainty, estimates, and factual limits.
- Keep the platform's core safety boundaries around serious illegal harm, exploitation, abuse, minors, trafficking, and non-consensual sexual content.
- Never claim tools, browsing, verification, or real-world actions that did not actually occur.
`;

const ADULT_MODE_PROMPT = `
Product mode: ADULT MODE.
- This mode is available only after the server has confirmed hard 18+ age verification for the signed-in account.
- Discuss lawful adult relationships, sexuality, sexual health, dating, mature fiction, and other adult subjects candidly and without unnecessary euphemism when relevant to the user's request.
- Treat all sexual or romantic participants as adults. Never sexualize minors or people whose age is ambiguous.
- Keep firm boundaries around exploitation, trafficking, coercion, non-consensual sexual content, serious illegal harm, and abuse.
- For medical, legal, or other high-stakes adult topics, clearly distinguish general information from personalized professional advice.
- Do not claim that age verification occurred because of the conversation; the server-side gate is the authority for access to this mode.
- Never claim tools, browsing, verification, or real-world actions that did not actually occur.
`;
''',
    'adult prompt'
)

one(
    server,
'''  if (normalized === "research") return "research";
  if (normalized === "creative") return "creative";
  if (normalized === "unbound") return "unbound";
  return "standard";
''',
'''  if (normalized === "research") return "research";
  if (normalized === "creative") return "creative";
  if (normalized === "unbound") return "unbound";
  if (normalized === "adult") return "adult";
  return "standard";
''',
    'server adult normalization'
)

# Both normal and streaming chat routes must enforce the hard server-side age gate.
many(
    server,
'''    if (productMode === "unbound") {
      await assertOptionalAccountCapability(req, "unbound_mode");
    }

    const persistentChat = await preparePersistentChat(
''',
'''    if (productMode === "unbound") {
      await assertOptionalAccountCapability(req, "unbound_mode");
    }
    if (productMode === "adult") {
      await assertAgeVerifiedAdult(req);
      await assertRequestCapability(req, "adult_mode");
    }

    const persistentChat = await preparePersistentChat(
''',
    2,
    'adult route gates'
)

one(
    server,
'''        : productMode === "unbound"
            ? UNBOUND_MODE_PROMPT
            : "";
''',
'''        : productMode === "unbound"
            ? UNBOUND_MODE_PROMPT
            : productMode === "adult"
              ? ADULT_MODE_PROMPT
              : "";
''',
    'adult non-stream instructions'
)

one(
    server,
'''    const modeInstructions =
      productMode === "creative"
        ? CREATIVE_MODE_PROMPT
        : productMode === "unbound"
          ? UNBOUND_MODE_PROMPT
          : "";
''',
'''    const modeInstructions =
      productMode === "creative"
        ? CREATIVE_MODE_PROMPT
        : productMode === "unbound"
          ? UNBOUND_MODE_PROMPT
          : productMode === "adult"
            ? ADULT_MODE_PROMPT
            : "";
''',
    'adult stream instructions'
)

# Age state participates in capability usability. Plan entitlement alone can never
# unlock Adult Mode without a current verified result.
one(
    server,
'''  const capabilities = buildCapabilityAccess({
    planTier: effective.plan.id,
    overrides
  });

  return {
''',
'''  const capabilities = buildCapabilityAccess({
    planTier: effective.plan.id,
    overrides
  }).map((item) => {
    if (item.key !== "adult_mode") return item;
    return {
      ...item,
      usable: Boolean(item.usable && ageVerification.verified),
      ageVerificationRequired: true,
      blockedReason: ageVerification.verified
        ? null
        : "hard-age-verification-required"
    };
  });
  const ageVerificationGateway = getAgeVerificationGatewayStatus();

  return {
''',
    'adult capability age gate'
)

one(
    server,
'''    capabilities,
    ageVerification,
    summary: {
''',
'''    capabilities,
    ageVerification,
    ageVerificationGateway,
    summary: {
''',
    'age gateway account access status'
)

# Fix the existing streaming route so every non-research product mode is persisted,
# metered, and reported accurately instead of being hard-coded as Standard Mode.
one(
    server,
'''    const persistentChat = await preparePersistentChat(
      req,
      message,
      depthStyle,
      "standard"
    );
''',
'''    const persistentChat = await preparePersistentChat(
      req,
      message,
      depthStyle,
      productMode
    );
''',
    'stream product mode persistence'
)

many(
    server,
'''      productMode: "standard",
''',
'''      productMode,
''',
    2,
    'stream metadata product mode'
)

one(
    server,
'''        depthStyle,
        "standard",
        { sources: [], citations: [], webSearchCalls: 0 }
''',
'''        depthStyle,
        productMode,
        { sources: [], citations: [], webSearchCalls: 0 }
''',
    'stream assistant persistence mode'
)

one(
    server,
'''          eventType: "chat_stream_standard_" + depthStyle,
''',
'''          eventType: "chat_stream_" + productMode + "_" + depthStyle,
''',
    'stream usage mode'
)

# Browser: add Adult Mode control and visual treatment.
one(
    index,
'''            <button id="standardModeButton" class="product-button active" data-product-mode="standard" type="button" aria-pressed="true">STANDARD</button>
            <button id="unboundModeButton" class="product-button" data-product-mode="unbound" type="button" aria-pressed="false">UNBOUND</button>
            <button id="creativeModeButton" class="product-button" data-product-mode="creative" type="button" aria-pressed="false">CREATIVE</button>
''',
'''            <button id="standardModeButton" class="product-button active" data-product-mode="standard" type="button" aria-pressed="true">STANDARD</button>
            <button id="unboundModeButton" class="product-button" data-product-mode="unbound" type="button" aria-pressed="false">UNBOUND</button>
            <button id="adultModeButton" class="product-button locked" data-product-mode="adult" type="button" aria-pressed="false" aria-disabled="true">ADULT</button>
            <button id="creativeModeButton" class="product-button" data-product-mode="creative" type="button" aria-pressed="false">CREATIVE</button>
''',
    'adult product button'
)

one(
    index,
'''    .product-control {
      display: inline-flex;
      align-items: center;
      gap: 4px;
''',
'''    .product-control {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
''',
    'product control wrapping'
)

one(
    index,
'''    .product-button.active[data-product-mode="unbound"] {
      background: rgba(101, 232, 164, 0.15);
      color: #b8ffd8;
      box-shadow: inset 0 0 0 1px rgba(101, 232, 164, 0.28);
    }
''',
'''    .product-button.active[data-product-mode="unbound"] {
      background: rgba(101, 232, 164, 0.15);
      color: #b8ffd8;
      box-shadow: inset 0 0 0 1px rgba(101, 232, 164, 0.28);
    }

    .product-button.active[data-product-mode="adult"] {
      background: rgba(255, 118, 118, 0.16);
      color: #ffd0d0;
      box-shadow: inset 0 0 0 1px rgba(255, 118, 118, 0.30);
    }
''',
    'adult active style'
)

# Make hard-verification state visible in Account Access.
one(
    index,
'''          <div class="access-stat"><div class="access-label">Capabilities</div><div id="accessCapabilitySummary" class="access-value">—</div></div>
''',
'''          <div class="access-stat"><div class="access-label">Capabilities</div><div id="accessCapabilitySummary" class="access-value">—</div></div>
          <div class="access-stat"><div class="access-label">Hard 18+ verification</div><div id="accessAgeVerification" class="access-value">—</div></div>
''',
    'adult access status card'
)

one(
    index,
'''    const standardModeButton = document.getElementById("standardModeButton");
    const unboundModeButton = document.getElementById("unboundModeButton");
    const creativeModeButton = document.getElementById("creativeModeButton");
''',
'''    const standardModeButton = document.getElementById("standardModeButton");
    const unboundModeButton = document.getElementById("unboundModeButton");
    const adultModeButton = document.getElementById("adultModeButton");
    const creativeModeButton = document.getElementById("creativeModeButton");
''',
    'adult DOM ref'
)

one(
    index,
'''    const accessCapabilitySummary = document.getElementById("accessCapabilitySummary");
    const accessCapabilityList = document.getElementById("accessCapabilityList");
''',
'''    const accessCapabilitySummary = document.getElementById("accessCapabilitySummary");
    const accessAgeVerification = document.getElementById("accessAgeVerification");
    const accessCapabilityList = document.getElementById("accessCapabilityList");
''',
    'adult access DOM ref'
)

one(
    index,
'''      if (value === "research") return "research";
      if (value === "creative") return "creative";
      if (value === "unbound") return "unbound";
      return "standard";
''',
'''      if (value === "research") return "research";
      if (value === "creative") return "creative";
      if (value === "unbound") return "unbound";
      if (value === "adult") return "adult";
      return "standard";
''',
    'adult browser normalization'
)

one(
    index,
'''      if (normalized === "unbound" && currentUser) {
        return canUseCapability("unbound_mode");
      }
      return true;
''',
'''      if (normalized === "unbound" && currentUser) {
        return canUseCapability("unbound_mode");
      }
      if (normalized === "adult") {
        return Boolean(
          currentUser &&
          canUseCapability("adult_mode") &&
          accountAccess?.ageVerification?.verified
        );
      }
      return true;
''',
    'adult account access normalization'
)

one(
    index,
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
'''      const isResearch = productMode === "research";
      const isCreative = productMode === "creative";
      const isUnbound = productMode === "unbound";
      const isAdult = productMode === "adult";
      const isStandard = !isResearch && !isCreative && !isUnbound && !isAdult;
      standardModeButton.classList.toggle("active", isStandard);
      unboundModeButton.classList.toggle("active", isUnbound);
      adultModeButton.classList.toggle("active", isAdult);
      creativeModeButton.classList.toggle("active", isCreative);
      researchModeButton.classList.toggle("active", isResearch);
      standardModeButton.setAttribute("aria-pressed", isStandard ? "true" : "false");
      unboundModeButton.setAttribute("aria-pressed", isUnbound ? "true" : "false");
      adultModeButton.setAttribute("aria-pressed", isAdult ? "true" : "false");
      creativeModeButton.setAttribute("aria-pressed", isCreative ? "true" : "false");
      researchModeButton.setAttribute("aria-pressed", isResearch ? "true" : "false");
      productStatus.textContent = isResearch
        ? "Research Mode — Live web search + citations"
        : isCreative
          ? "Creative Mode — Ideas, writing + worldbuilding"
          : isUnbound
            ? "Unbound Mode — Candid, direct conversation"
            : isAdult
              ? "Adult Mode — Verified 18+ mature conversation"
              : "Standard Mode";
''',
    'adult browser rendering'
)

one(
    index,
'''              : productMode === "unbound"
                ? "Unbound Mode is active. UNBOUND will be especially candid and direct."
                : "Standard Mode is active."
''',
'''              : productMode === "unbound"
                ? "Unbound Mode is active. UNBOUND will be especially candid and direct."
                : productMode === "adult"
                  ? "Adult Mode is active for this hard-verified 18+ account."
                  : "Standard Mode is active."
''',
    'adult mode toast'
)

# Account Access status and capability badge clearly show that the mode is locked by
# hard verification, not merely 'planned'.
one(
    index,
'''        accessSubscription.textContent = "—";
        accessCapabilitySummary.textContent = "—";
        accessCapabilityList.innerHTML = "";
''',
'''        accessSubscription.textContent = "—";
        accessCapabilitySummary.textContent = "—";
        accessAgeVerification.textContent = "—";
        accessCapabilityList.innerHTML = "";
''',
    'adult empty access status'
)

one(
    index,
'''      accessSubscription.textContent = subscriptionLabel(accountAccess.subscription);
      accessCapabilitySummary.textContent = `${accountAccess.summary?.usable || 0} live / ${accountAccess.summary?.catalogSize || 0} tracked`;
      accessCapabilityList.innerHTML = "";
''',
'''      accessSubscription.textContent = subscriptionLabel(accountAccess.subscription);
      accessCapabilitySummary.textContent = `${accountAccess.summary?.usable || 0} live / ${accountAccess.summary?.catalogSize || 0} tracked`;
      const ageState = accountAccess.ageVerification || {};
      const ageGateway = accountAccess.ageVerificationGateway || {};
      accessAgeVerification.textContent = ageState.verified
        ? "VERIFIED 18+"
        : ageGateway.configured
          ? String(ageState.status || "unverified").replaceAll("_", " ").toUpperCase()
          : "PROVIDER NOT CONNECTED";
      accessCapabilityList.innerHTML = "";
''',
    'adult access status rendering'
)

one(
    index,
'''        if (capability.usable) { badge.classList.add("live"); badge.textContent = "LIVE"; }
        else if (capability.available && !capability.entitled) { badge.classList.add("locked"); badge.textContent = `${String(capability.minimumPlan || "top").toUpperCase()} ACCESS`; }
''',
'''        if (capability.usable) { badge.classList.add("live"); badge.textContent = "LIVE"; }
        else if (capability.key === "adult_mode" && capability.available && capability.entitled) { badge.classList.add("locked"); badge.textContent = "18+ VERIFY"; }
        else if (capability.available && !capability.entitled) { badge.classList.add("locked"); badge.textContent = `${String(capability.minimumPlan || "top").toUpperCase()} ACCESS`; }
''',
    'adult access badge'
)

# Adult selection is intentionally separate from a browser checkbox. The browser can
# request it, but the server will independently reject it unless hard verification is current.
one(
    index,
'''    async function chooseResearchMode() {
      if (!currentUser) { showToast("Research Mode requires a signed-in TOP account."); openAuth("login"); return; }
      if (!accountAccess) await refreshAccountAccess({ silent: true });
      if (!canUseCapability("web_research")) { showToast("Research Mode requires TOP access."); await openAccess(); return; }
      setProductMode("research", { announce: true });
    }
''',
'''    async function chooseResearchMode() {
      if (!currentUser) { showToast("Research Mode requires a signed-in TOP account."); openAuth("login"); return; }
      if (!accountAccess) await refreshAccountAccess({ silent: true });
      if (!canUseCapability("web_research")) { showToast("Research Mode requires TOP access."); await openAccess(); return; }
      setProductMode("research", { announce: true });
    }

    async function chooseAdultMode() {
      if (!currentUser) {
        showToast("Adult Mode requires a signed-in account with hard 18+ verification.");
        openAuth("login");
        return;
      }
      if (!accountAccess) await refreshAccountAccess({ silent: true });
      const capability = capabilityAccess("adult_mode");
      if (!capability?.entitled || !capability?.available) {
        showToast("Adult Mode is not included in this account's current access.");
        await openAccess();
        return;
      }
      if (!accountAccess?.ageVerification?.verified) {
        const gatewayReady = Boolean(accountAccess?.ageVerificationGateway?.configured);
        showToast(
          gatewayReady
            ? "Complete hard 18+ age verification before using Adult Mode."
            : "Adult Mode is locked until a hard 18+ verification provider is connected."
        );
        await openAccess();
        return;
      }
      setProductMode("adult", { announce: true });
    }
''',
    'adult mode chooser'
)

# Signed-in and signed-out lock state.
one(
    index,
'''        const creativeAllowed = canUseCapability("creative_mode");
''',
'''        const adultVerified = Boolean(accountAccess?.ageVerification?.verified);
        const adultAllowed = canUseCapability("adult_mode") && adultVerified;
        const adultGatewayReady = Boolean(accountAccess?.ageVerificationGateway?.configured);
        adultModeButton.classList.toggle("locked", !adultAllowed);
        adultModeButton.setAttribute("aria-disabled", adultAllowed ? "false" : "true");
        adultModeButton.title = adultAllowed
          ? "Adult Mode"
          : adultGatewayReady
            ? "Adult Mode requires completed hard 18+ verification"
            : "Adult Mode locked — hard age-verification provider is not connected yet";
        const creativeAllowed = canUseCapability("creative_mode");
''',
    'adult signed-in access UI'
)

one(
    index,
'''      creativeModeButton.classList.remove("locked");
''',
'''      adultModeButton.classList.add("locked");
      adultModeButton.setAttribute("aria-disabled", "true");
      adultModeButton.title = "Adult Mode requires a signed-in account with hard 18+ verification";
      creativeModeButton.classList.remove("locked");
''',
    'adult guest access UI'
)

one(
    index,
'''    creativeModeButton.addEventListener("click", () => {
''',
'''    adultModeButton.addEventListener("click", chooseAdultMode);
    creativeModeButton.addEventListener("click", () => {
''',
    'adult click behavior'
)

print('Applied UNBOUND AI Adult Mode v0.22 and streaming product-mode persistence fix.')
