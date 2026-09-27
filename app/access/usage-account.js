"use strict";
const { getPlanDefinition } = require("./entitlements");
const { subscriptionStatusAllowsAccess } = require("../billing/gateway");
async function storedUsageTier(client, userId) {
  const result = await client.query(`SELECT u.plan_tier, u.role, u.complimentary_top_tier, s.plan_tier AS subscription_plan, s.status AS subscription_status
    FROM users u LEFT JOIN account_subscriptions s ON s.user_id = u.id WHERE u.id = $1 LIMIT 1`, [userId]);
  const row = result.rows[0];
  if (!row) return "free";
  if (row.role === "admin" || row.complimentary_top_tier) return "ultra";
  const manual = getPlanDefinition(row.plan_tier);
  const subscription = getPlanDefinition(subscriptionStatusAllowsAccess(row.subscription_status) ? row.subscription_plan : "free");
  return subscription.rank > manual.rank ? subscription.id : manual.id;
}
module.exports = { storedUsageTier };
