(() => {
  "use strict";

  function normalizeTier(value) {
    const tier = String(value || "").trim().toLowerCase();
    if (tier === "top") return "ultra";
    if (["free", "premium", "ultra"].includes(tier)) return tier;
    return "free";
  }

  function tierLabel(value) {
    const tier = normalizeTier(value);
    if (tier === "premium") return "PREMIUM";
    if (tier === "ultra") return "ULTRA";
    return "FREE";
  }

  function syncPlanSelect(select) {
    const row = select.closest("tr");
    const badges = row ? Array.from(row.querySelectorAll(".badge")) : [];
    const planBadge = badges.length > 1 ? badges[1] : null;
    const rawFromBadge = planBadge ? planBadge.textContent : select.value;
    const current = normalizeTier(rawFromBadge || select.value);

    const desired = [
      ["free", "FREE"],
      ["premium", "PREMIUM"],
      ["ultra", "ULTRA"]
    ];
    const currentOptions = Array.from(select.options).map((option) => `${option.value}:${option.textContent}`).join("|");
    const desiredOptions = desired.map(([value, label]) => `${value}:${label}`).join("|");
    if (currentOptions !== desiredOptions) {
      select.replaceChildren(...desired.map(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
      }));
    }
    select.value = current;

    if (planBadge) {
      planBadge.textContent = tierLabel(current);
      planBadge.classList.toggle("gold", current === "ultra");
    }
  }

  function syncVisibleTiers() {
    document.querySelectorAll("select.plan-select").forEach(syncPlanSelect);

    const adminName = document.getElementById("adminName");
    if (adminName && /\bTOP\b/.test(adminName.textContent || "")) {
      adminName.textContent = adminName.textContent.replace(/\bTOP\b/g, "ULTRA");
    }

    document.querySelectorAll("#billingSubscriptionsBody tr").forEach((row) => {
      const badges = Array.from(row.querySelectorAll(".badge"));
      for (const badge of badges) {
        const text = String(badge.textContent || "").trim().toLowerCase();
        if (text === "top") {
          badge.textContent = "ultra";
          badge.classList.add("gold");
        } else if (text === "ultra") {
          badge.classList.add("gold");
        }
      }
    });

    const statTop = document.getElementById("statTop");
    const statLabel = statTop?.closest(".stat")?.querySelector(".label");
    if (statLabel) statLabel.textContent = "Ultra Tier";
  }

  function initialize() {
    syncVisibleTiers();
    const observer = new MutationObserver(syncVisibleTiers);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
