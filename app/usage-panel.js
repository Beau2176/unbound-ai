(() => {
  "use strict";
  async function load(panel) {
    const content = panel.querySelector("[data-usage-content]");
    content.textContent = "Loading usage…";
    try {
      const response = await fetch("/api/usage-policy", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Could not load limits.");
      const policy = await response.json();
      const accountResponse = await fetch("/api/account/usage", { credentials: "same-origin" });
      const account = accountResponse.ok ? await accountResponse.json() : null;
      content.replaceChildren();
      const description = document.createElement("p");
      description.textContent = "Casual chat uses 1 chat credit and Work/Research use 3 when a plan is metered. Unlimited has no five-hour or weekly normal-chat cap. Research and other high-cost tools remain metered, and fair-use/abuse safeguards still apply.";
      content.append(description);
      if (account) {
        const title = document.createElement("h4"); title.textContent = "Your remaining allowance"; content.append(title);
        for (const window of account.windows) {
          const line = document.createElement("p");
          line.textContent = `${window.label} · ${window.window === "session" ? "5 hours" : "7 days"}: ${window.remaining} of ${window.limit} remaining. ${window.active ? `Resets ${new Date(window.resetAt).toLocaleString()}.` : "Starts when you first use it."}`;
          content.append(line);
        }
      } else {
        const note = document.createElement("p"); note.textContent = "Sign in to see your remaining allowance and reset times."; content.append(note);
      }
      for (const plan of policy.plans) {
        const title = document.createElement("h4");
        title.textContent = `${plan.displayName} · $${Number(plan.priceMonthlyUsd).toFixed(2)}/month${plan.commercialState === "future" ? " · Coming later" : ""}`;
        content.append(title);
        const list = document.createElement("ul");
        for (const [feature, limits] of Object.entries(plan.limits)) {
          const item = document.createElement("li");
          item.textContent = limits === null
            ? `${policy.features[feature]}: Unlimited everyday use; fair-use and abuse safeguards apply.`
            : `${policy.features[feature]}: ${limits[0]} per 5 hours; ${limits[1]} per 7 days.`;
          list.append(item);
        }
        content.append(list);
      }
      const rules = document.createElement("p"); rules.textContent = `${policy.resetRule} ${policy.countingRule}`; content.append(rules);
    } catch (error) { content.textContent = error.message || "Could not load usage. Try refreshing."; }
  }
  function init() {
    const host = document.getElementById("billingActions");
    if (!host || document.getElementById("usageLimitsPanel")) return;
    const panel = document.createElement("details"); panel.id = "usageLimitsPanel";
    panel.style.cssText = "width:100%;max-height:65vh;overflow:auto;padding:12px;border:1px solid #57718d;border-radius:10px;color:inherit;font-size:13px;line-height:1.6;box-sizing:border-box";
    const summary = document.createElement("summary"); summary.textContent = "Usage & limits"; summary.style.cursor = "pointer";
    const button = document.createElement("button"); button.type = "button"; button.className = "auth-submit secondary"; button.textContent = "Refresh usage";
    const content = document.createElement("div"); content.dataset.usageContent = "";
    panel.append(summary, button, content); host.append(panel);
    panel.addEventListener("toggle", () => { if (panel.open) load(panel); });
    button.addEventListener("click", () => load(panel));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
})();
