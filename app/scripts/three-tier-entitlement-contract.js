const assert = require("assert");
const {
  PLAN_DEFINITIONS,
  CAPABILITY_CATALOG,
  normalizePlanTier,
  buildCapabilityAccess
} = require("../access/entitlements");

function accessMap(planTier) {
  return new Map(buildCapabilityAccess({ planTier }).map((item) => [item.key, item]));
}

function main() {
  assert.deepStrictEqual(
    Object.keys(PLAN_DEFINITIONS),
    ["free", "premium", "ultra", "max"]
  );
  assert.strictEqual(PLAN_DEFINITIONS.free.priceMonthlyUsd, 0);
  assert.strictEqual(PLAN_DEFINITIONS.premium.priceMonthlyUsd, 29.99);
  assert.strictEqual(PLAN_DEFINITIONS.ultra.priceMonthlyUsd, 99.99);
  assert.ok(PLAN_DEFINITIONS.free.rank < PLAN_DEFINITIONS.premium.rank);
  assert.strictEqual(PLAN_DEFINITIONS.max.priceMonthlyUsd, 199.99);
  assert.strictEqual(PLAN_DEFINITIONS.max.commercialState, "future");
  assert.ok(PLAN_DEFINITIONS.premium.rank < PLAN_DEFINITIONS.ultra.rank);
  assert.ok(PLAN_DEFINITIONS.ultra.rank < PLAN_DEFINITIONS.max.rank);

  assert.strictEqual(normalizePlanTier("top"), "ultra");
  assert.strictEqual(normalizePlanTier("premium"), "premium");
  assert.strictEqual(normalizePlanTier("garbage"), "free");

  const free = accessMap("free");
  const premium = accessMap("premium");
  const ultra = accessMap("ultra");
  const max = accessMap("max");
  const legacyTop = accessMap("top");

  for (const capability of ["chat", "casual_mode", "work_mode", "creative_mode", "unbound_mode"]) {
    assert.strictEqual(free.get(capability).usable, true, `${capability} must remain Free`);
  }
  for (const capability of ["web_research", "citations", "file_analysis", "artifact_creation", "image_understanding", "voice", "memory"]) {
    assert.strictEqual(free.get(capability).usable, false, `${capability} must not be Free`);
    assert.strictEqual(premium.get(capability).usable, true, `${capability} must be Premium`);
  }
  for (const capability of ["image_tools", "agents", "monitoring", "multi_model", "connected_apps", "command_center", "adult_mode"]) {
    assert.strictEqual(premium.get(capability).usable, false, `${capability} must not be Premium`);
    assert.strictEqual(ultra.get(capability).usable, true, `${capability} must be Ultra`);
    assert.strictEqual(legacyTop.get(capability).usable, true, `legacy TOP must retain ${capability} through Ultra alias`);
    assert.strictEqual(max.get(capability).usable, true, `MAX must inherit launched Ultra capability ${capability}`);
  }

  assert.strictEqual(CAPABILITY_CATALOG.adult_mode.minimumPlan, "ultra");
  assert.match(CAPABILITY_CATALOG.adult_mode.description, /18\+/i);
  assert.match(CAPABILITY_CATALOG.adult_mode.description, /Ultra/i);

  console.log("Four-plan entitlement contract passed: Free, Premium, Ultra, and future Max.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
