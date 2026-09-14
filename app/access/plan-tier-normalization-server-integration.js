"use strict";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Plan-tier normalization marker missing: ${label}.`);
    error.code = "PLAN_TIER_NORMALIZATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Plan-tier normalization marker ambiguous: ${label}.`);
    error.code = "PLAN_TIER_NORMALIZATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integratePlanTierNormalizationServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "PLAN_TIER_NORMALIZATION_SOURCE_EMPTY";
    throw error;
  }
  if (source.includes("PLAN_TIER_NORMALIZATION_V098_APPLIED")) return source;

  source = replaceExactlyOnce(
    source,
    `  await pool.query(\`\n    DELETE FROM rate_limit_buckets`,
    `  await pool.query(\`\n    UPDATE users\n    SET plan_tier = 'ultra',\n        updated_at = NOW()\n    WHERE LOWER(TRIM(plan_tier)) = 'top';\n\n    UPDATE account_subscriptions\n    SET plan_tier = 'ultra',\n        updated_at = NOW()\n    WHERE LOWER(TRIM(plan_tier)) = 'top';\n  \`);\n\n  await pool.query(\`\n    DELETE FROM rate_limit_buckets`,
    "legacy-top-database-migration"
  );

  source = replaceExactlyOnce(
    source,
    `       SET role = 'admin',\n           plan_tier = 'top',\n           updated_at = NOW()`,
    `       SET role = 'admin',\n           plan_tier = 'ultra',\n           updated_at = NOW()`,
    "owner-ultra-startup"
  );

  source = replaceExactlyOnce(
    source,
    `    role: user.role,\n    planTier: user.plan_tier,\n    complimentaryTopTier: Boolean(user.complimentary_top_tier),`,
    `    role: user.role,\n    planTier: normalizePlanTier(user.plan_tier),\n    complimentaryTopTier: Boolean(user.complimentary_top_tier),`,
    "public-user-plan-normalization"
  );

  source = replaceExactlyOnce(
    source,
    `    return { plan: getPlanDefinition("top"), source: "administrator" };`,
    `    return { plan: getPlanDefinition("ultra"), source: "administrator" };`,
    "administrator-effective-plan"
  );

  source = replaceExactlyOnce(
    source,
    `    return { plan: getPlanDefinition("top"), source: "complimentary" };`,
    `    return { plan: getPlanDefinition("ultra"), source: "complimentary" };`,
    "complimentary-effective-plan"
  );

  source = replaceExactlyOnce(
    source,
    `          planTier: accountRow.plan_tier,`,
    `          planTier: normalizePlanTier(accountRow.plan_tier),`,
    "data-export-plan-normalization"
  );

  source = replaceExactlyOnce(
    source,
    `        planTier: user.plan_tier,\n        complimentarySlot:`,
    `        planTier: normalizePlanTier(user.plan_tier),\n        complimentarySlot:`,
    "admin-overview-plan-normalization"
  );

  source = replaceExactlyOnce(
    source,
    `            planTier: updateResult.rows[0].plan_tier,`,
    `            planTier: normalizePlanTier(updateResult.rows[0].plan_tier),`,
    "admin-plan-response-normalization"
  );

  return `${source}\n/* PLAN_TIER_NORMALIZATION_V098_APPLIED */\n`;
}

module.exports = {
  integratePlanTierNormalizationServerSource,
  replaceExactlyOnce
};
