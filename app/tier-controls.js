(() => {
  "use strict";

  const PLAN_RANK = Object.freeze({ free: 0, premium: 50, ultra: 100 });
  const PLAN_COPY = Object.freeze({
    free: {
      name: "FREE",
      price: "$0",
      note: "Core chat, Casual/Work modes, Creative and Unbound modes."
    },
    premium: {
      name: "PREMIUM",
      price: "$59.99 / month",
      note: "Everything in Free plus web research, citations, file analysis, photo/image understanding, voice and Memory."
    },
    ultra: {
      name: "ULTRA",
      price: "$114.99 / month",
      note: "Everything in Premium plus advanced image tools, agents, scheduled monitoring, multi-model routing, connected apps, Command Center and verified-18+ Adult Mode."
    }
  });

  function normalizePlan(value) {
    const raw = String(value || "free").trim().toLowerCase();
    return raw === "top" ? "ultra" : (PLAN_RANK[raw] !== undefined ? raw : "free");
  }

  function injectStyles() {
    if (document.getElementById("unbound-tier-controls-style")) return;
    const style = document.createElement("style");
    style.id = "unbound-tier-controls-style";
    style.textContent = `
      .unbound-tier-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:10px 0 12px}
      .unbound-tier-card{display:flex;flex-direction:column;gap:7px;min-width:0;padding:13px;border:1px solid rgba(107,193,255,.28);border-radius:14px;background:rgba(6,14,27,.8)}
      .unbound-tier-card[data-plan="ultra"]{border-color:rgba(255,173,67,.45);background:linear-gradient(160deg,rgba(255,173,67,.1),rgba(6,14,27,.88) 45%)}
      .unbound-tier-name{font-size:12px;font-weight:900;letter-spacing:.09em}
      .unbound-tier-price{font-size:18px;font-weight:900;color:#fff}
      .unbound-tier-note{flex:1;color:#b9c9da;font-size:11px;line-height:1.45}
      .unbound-tier-current{color:#65e8a4;font-size:10px;font-weight:900;letter-spacing:.06em}
      .unbound-tier-button{min-height:38px;border:1px solid rgba(107,193,255,.4);border-radius:10px;background:rgba(66,165,255,.13);color:#eef8ff;font-weight:900;cursor:pointer}
      .unbound-tier-button.ultra{border-color:rgba(255,173,67,.5);background:rgba(255,173,67,.13);color:#fff0d9}
      .unbound-tier-button:disabled{cursor:not-allowed;opacity:.55}
      .unbound-tier-disclosure{margin:4px 0 8px;color:#9fb3c8;font-size:10px;line-height:1.45}
      @media(max-width:700px){.unbound-tier-grid{grid-template-columns:1fr}.unbound-tier-card{padding:12px}.unbound-tier-price{font-size:17px}}
    `;
    document.head.appendChild(style);
  }

  async function readJson(response) {
    try { return await response.json(); } catch (_) { return {}; }
  }

  async function loadAccess() {
    const response = await fetch("/api/account/access", {
      credentials: "same-origin",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) return null;
    const data = await readJson(response);
    return data.access || null;
  }

  async function startCheckout(planTier, note, button) {
    if (button) button.disabled = true;
    if (note) note.textContent = `Opening ${PLAN_COPY[planTier].name} secure checkout…`;
    try {
      const response = await fetch("/api/account/billing/checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ planTier })
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not start subscription checkout.");
      const url = String(data.checkout?.checkoutUrl || "");
      if (!url.startsWith("https://")) throw new Error("The billing provider returned an invalid secure checkout URL.");
      window.location.assign(url);
    } catch (error) {
      if (note) note.textContent = error.message || "Could not start subscription checkout.";
      if (button) button.disabled = false;
    }
  }

  function buildCard(planId) {
    const plan = PLAN_COPY[planId];
    const card = document.createElement("div");
    card.className = "unbound-tier-card";
    card.dataset.plan = planId;
    card.innerHTML = `
      <div class="unbound-tier-name">TIER ${planId === "free" ? "1" : planId === "premium" ? "2" : "3"} · ${plan.name}</div>
      <div class="unbound-tier-price">${plan.price}</div>
      <div class="unbound-tier-note">${plan.note}</div>
      <div class="unbound-tier-current" data-tier-current hidden>CURRENT ACCESS</div>
    `;
    if (planId !== "free") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `unbound-tier-button ${planId}`;
      button.dataset.tierCheckout = planId;
      button.textContent = planId === "premium" ? "CHOOSE PREMIUM" : "CHOOSE ULTRA";
      card.appendChild(button);
    }
    return card;
  }

  function ensureTierUi() {
    const billingActions = document.getElementById("billingActions");
    if (!billingActions) return null;

    const oldUpgrade = document.getElementById("billingUpgradeButton");
    if (oldUpgrade) {
      oldUpgrade.hidden = true;
      oldUpgrade.style.display = "none";
      if (!oldUpgrade.dataset.threeTierIntercepted) {
        oldUpgrade.dataset.threeTierIntercepted = "true";
        oldUpgrade.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
        }, true);
      }
    }

    let grid = document.getElementById("unboundTierGrid");
    if (!grid) {
      grid = document.createElement("div");
      grid.id = "unboundTierGrid";
      grid.className = "unbound-tier-grid";
      grid.append(buildCard("free"), buildCard("premium"), buildCard("ultra"));
      billingActions.prepend(grid);

      const disclosure = document.createElement("div");
      disclosure.className = "unbound-tier-disclosure";
      disclosure.textContent = "Adult Mode is Ultra-only and still requires successful hard 18+ verification. Payment alone never bypasses the age gate.";
      grid.after(disclosure);
    }
    return { billingActions, grid };
  }

  async function refreshTierUi() {
    const ui = ensureTierUi();
    if (!ui) return;
    const note = document.getElementById("billingActionNote");
    const portalButton = document.getElementById("billingPortalButton");

    let access = null;
    try { access = await loadAccess(); } catch (_) {}
    if (!access) return;

    const currentPlan = normalizePlan(access.plan?.tier);
    const activePaid = Boolean(
      access.subscription?.connected &&
      ["active", "trialing"].includes(String(access.subscription?.status || "").toLowerCase())
    );
    const checkoutAvailable = Boolean(access.billingGateway?.configured && access.billingGateway?.checkout);

    for (const card of ui.grid.querySelectorAll(".unbound-tier-card")) {
      const planId = card.dataset.plan;
      const current = card.querySelector("[data-tier-current]");
      if (current) current.hidden = planId !== currentPlan;
      const button = card.querySelector("[data-tier-checkout]");
      if (!button) continue;

      const alreadyIncluded = PLAN_RANK[currentPlan] >= PLAN_RANK[planId];
      if (alreadyIncluded) {
        button.disabled = true;
        button.textContent = currentPlan === planId ? "CURRENT PLAN" : "INCLUDED";
        continue;
      }
      if (activePaid) {
        button.disabled = false;
        button.textContent = "MANAGE BILLING TO UPGRADE";
        button.onclick = () => portalButton?.click();
        continue;
      }
      button.disabled = !checkoutAvailable;
      button.textContent = planId === "premium" ? "CHOOSE PREMIUM · $59.99" : "CHOOSE ULTRA · $114.99";
      button.onclick = () => startCheckout(planId, note, button);
    }

    if (!checkoutAvailable && note && !activePaid) {
      note.textContent = "Premium and Ultra are defined and ready in UNBOUND, but live payment checkout stays off until the billing provider is approved and connected.";
    }
  }

  function initialize() {
    injectStyles();
    ensureTierUi();
    refreshTierUi();

    const billingActions = document.getElementById("billingActions");
    if (billingActions) {
      const observer = new MutationObserver(() => {
        ensureTierUi();
        if (!billingActions.hidden) refreshTierUi();
      });
      observer.observe(billingActions, { attributes: true, attributeFilter: ["hidden"], childList: true, subtree: false });
    }

    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest("#accountButton, #accessButton, [data-open-access]")) {
        setTimeout(refreshTierUi, 0);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
