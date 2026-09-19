"use strict";

function replaceOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  if (first === -1) {
    const error = new Error(`Admin three-tier integration marker missing: ${label}.`);
    error.code = "ADMIN_THREE_TIER_MARKER_MISSING";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateAdminThreeTierServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "ADMIN_THREE_TIER_SOURCE_EMPTY";
    throw error;
  }
  if (source.includes("ADMIN_THREE_TIER_V098_APPLIED")) return source;

  source = replaceOnce(
    source,
    `      const planTier =\n        typeof req.body.planTier === "string"\n          ? req.body.planTier.trim().toLowerCase()\n          : "";`,
    `      const requestedPlanTier =\n        typeof req.body.planTier === "string"\n          ? req.body.planTier.trim().toLowerCase()\n          : "";\n      // Legacy admin clients may still submit \"top\"; treat it as Ultra.\n      const planTier = requestedPlanTier === "top" ? "ultra" : requestedPlanTier;`,
    "plan-normalization"
  );

  source = replaceOnce(
    source,
    `      if (!["free", "top"].includes(planTier)) {\n        return res.status(400).json({\n          error: "Plan must be FREE or TOP."\n        });\n      }`,
    `      if (!["free", "premium", "ultra"].includes(planTier)) {\n        return res.status(400).json({\n          error: "Plan must be FREE, PREMIUM, or ULTRA."\n        });\n      }`,
    "plan-validation"
  );

  source = replaceOnce(
    source,
    `      if (normalizeEmail(target.email) === ownerEmail && planTier !== "top") {\n        return res.status(400).json({\n          error: "The owner account must remain on the TOP plan."\n        });\n      }`,
    `      if (normalizeEmail(target.email) === ownerEmail && planTier !== "ultra") {\n        return res.status(400).json({\n          error: "The owner account must remain on the ULTRA plan."\n        });\n      }`,
    "owner-ultra"
  );

  source = replaceOnce(
    source,
    `        if (planTier !== "top") {`,
    `        if (planTier !== "ultra") {`,
    "gift-removal-on-downgrade"
  );

  source = replaceOnce(
    source,
    `          error: "The owner account already has permanent TOP access."`,
    `          error: "The owner account already has permanent ULTRA access."`,
    "owner-gift-message"
  );

  source = replaceOnce(
    source,
    `              "All five complimentary TOP-tier gift slots are already assigned."`,
    `              "All five complimentary ULTRA gift slots are already assigned."`,
    "gift-slots-full-message"
  );

  source = replaceOnce(
    source,
    `        error: "Could not grant complimentary TOP-tier access."`,
    `        error: "Could not grant complimentary ULTRA access."`,
    "gift-error-ultra"
  );

  source = replaceOnce(
    source,
    `        error: "Could not revoke complimentary TOP-tier access."`,
    `        error: "Could not revoke complimentary ULTRA access."`,
    "revoke-error-ultra"
  );

  source = replaceOnce(
    source,
    `          topTier: users.filter((user) => user.planTier === "top").length,`,
    `          topTier: users.filter((user) => ["ultra", "top"].includes(user.planTier)).length,`,
    "overview-ultra-count"
  );

  const adminApiMarker = "/* ----------------------------- ADMIN API ----------------------------- */";
  if (!source.includes(adminApiMarker)) {
    const error = new Error("Admin API marker missing while installing three-tier admin script route.");
    error.code = "ADMIN_THREE_TIER_ROUTE_MARKER_MISSING";
    throw error;
  }
  const route = `app.get("/admin-three-tier.js", requireDatabase, requireAdmin, (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "admin-three-tier.js"));\n});\n\n`;
  source = source.replace(adminApiMarker, route + adminApiMarker);

  return `${source}\n/* ADMIN_THREE_TIER_V098_APPLIED */\n`;
}

module.exports = { integrateAdminThreeTierServerSource };
