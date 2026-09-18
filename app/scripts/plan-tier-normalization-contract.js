"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { integrateBillingServerSource } = require("../billing/server-integration");
const { integrateAdminThreeTierServerSource } = require("../access/admin-three-tier-server-integration");
const {
  integratePlanTierNormalizationServerSource
} = require("../access/plan-tier-normalization-server-integration");
const {
  PLAN_DEFINITIONS,
  LEGACY_PLAN_ALIASES,
  normalizePlanTier,
  getPlanDefinition
} = require("../access/entitlements");

const serverPath = path.join(__dirname, "..", "server.js");
const baseSource = fs.readFileSync(serverPath, "utf8");
let source = integrateBillingServerSource(baseSource);
source = integrateAdminThreeTierServerSource(source);
source = integratePlanTierNormalizationServerSource(source);

assert.deepStrictEqual(Object.keys(PLAN_DEFINITIONS), ["free", "premium", "ultra", "max"]);
assert.strictEqual(LEGACY_PLAN_ALIASES.top, "ultra");
assert.strictEqual(normalizePlanTier("top"), "ultra");
assert.strictEqual(normalizePlanTier(" TOP "), "ultra");
assert.strictEqual(getPlanDefinition("top").id, "ultra");
assert.strictEqual(getPlanDefinition("premium").priceMonthlyUsd, 49.99);
assert.strictEqual(getPlanDefinition("ultra").priceMonthlyUsd, 129.99);
assert.strictEqual(getPlanDefinition("max").priceMonthlyUsd, 199.99);
assert.strictEqual(getPlanDefinition("max").commercialState, "future");

assert(source.includes("UPDATE users\n    SET plan_tier = 'ultra'"));
assert(source.includes("WHERE LOWER(TRIM(plan_tier)) = 'top';"));
assert(source.includes("UPDATE account_subscriptions\n    SET plan_tier = 'ultra'"));
assert(source.includes("plan_tier = 'ultra',\n           updated_at = NOW()\n       WHERE email = $1"));

assert(source.includes("planTier: normalizePlanTier(user.plan_tier)"));
assert(source.includes("planTier: normalizePlanTier(accountRow.plan_tier)"));
assert(source.includes("planTier: normalizePlanTier(updateResult.rows[0].plan_tier)"));
assert(source.includes("planTier: normalizePlanTier(user.plan_tier),\n        complimentarySlot:"));
assert(source.includes('getPlanDefinition("ultra"), source: "administrator"'));
assert(source.includes('getPlanDefinition("ultra"), source: "complimentary"'));

assert(!source.includes("plan_tier = 'top',\n           updated_at = NOW()\n       WHERE email = $1"));
assert(!source.includes('getPlanDefinition("top")'));
assert(!source.includes("planTier: user.plan_tier,"));
assert(!source.includes("planTier: accountRow.plan_tier,"));
assert(!source.includes("planTier: updateResult.rows[0].plan_tier,"));
assert(!source.includes('planTier: "top",'));
assert(!source.includes("VALUES ($1, $2, 'incomplete', 'top', $3"));

// The legacy table and audit identifiers intentionally remain for database/history compatibility.
assert(source.includes("complimentary_top_tier_grants"));
assert(source.includes("complimentary_top_tier.granted"));

const reapplied = integratePlanTierNormalizationServerSource(source);
assert.strictEqual(reapplied, source, "plan-tier normalization integration must be idempotent");

console.log("Canonical plan normalization contract passed with future MAX support.");
