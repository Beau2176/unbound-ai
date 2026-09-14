const assert = require("assert");
const {
  buildNoSpendLaunchPreflight,
  formatText
} = require("./no-spend-launch-preflight");

const NOW = Date.parse("2026-09-14T12:00:00.000Z");

const empty = buildNoSpendLaunchPreflight({ env: {}, nowMs: NOW });
assert.strictEqual(empty.profile, "no_spend_launch_preflight");
assert.strictEqual(empty.stages.length, 8);
assert.strictEqual(empty.eligibleToScheduleFinalRehearsal, false);
assert.strictEqual(empty.nextFreeStage, "infrastructure");
assert.strictEqual(empty.stages.find((stage) => stage.key === "infrastructure").ready, false);
assert.strictEqual(empty.stages.find((stage) => stage.key === "backup_restore").ready, false);
assert.strictEqual(empty.stages.find((stage) => stage.key === "business_bank").ready, false);
assert.strictEqual(empty.stages.find((stage) => stage.key === "segpay").ready, false);
assert.strictEqual(empty.stages.find((stage) => stage.key === "yoti").ready, false);
assert.strictEqual(empty.stages.find((stage) => stage.key === "ses").ready, false);
assert.strictEqual(empty.stages.find((stage) => stage.key === "legal").ready, false);
assert.strictEqual(empty.stages.find((stage) => stage.key === "clamav").ready, false);

const syntheticPreparedInfra = buildNoSpendLaunchPreflight({
  env: {
    UNBOUND_INFRA_PROFILE: "production",
    UNBOUND_INFRA_PRODUCTION_READY: "true",
    UNBOUND_INFRA_ALWAYS_ON_COMPUTE: "true",
    UNBOUND_INFRA_DURABLE_DATABASE: "true",
    UNBOUND_INFRA_HEALTH_CHECK_CONFIGURED: "true",
    UNBOUND_INFRA_REVIEWED_AT: "2026-09-14T11:30:00.000Z",
    DATABASE_BACKUP_MODE: "managed",
    DATABASE_RESTORE_LAST_TESTED_AT: "2026-09-14T11:00:00.000Z"
  },
  nowMs: NOW
});
assert.strictEqual(
  syntheticPreparedInfra.stages.find((stage) => stage.key === "infrastructure").ready,
  true
);
assert.strictEqual(
  syntheticPreparedInfra.stages.find((stage) => stage.key === "backup_restore").ready,
  true
);
assert.strictEqual(syntheticPreparedInfra.eligibleToScheduleFinalRehearsal, false);
assert.strictEqual(syntheticPreparedInfra.nextFreeStage, "business_bank");

const secretSentinels = [
  "AWS-SECRET-SENTINEL",
  "SEGPAY-SECRET-SENTINEL",
  "YOTI-SECRET-SENTINEL",
  "DATABASE-SECRET-SENTINEL",
  "PRIVATE-CLAMAV-SENTINEL"
];
const secretEnv = {
  AWS_SECRET_ACCESS_KEY: secretSentinels[0],
  SEGPAY_SIGNING_KEY: secretSentinels[1],
  YOTI_API_KEY: secretSentinels[2],
  DATABASE_URL: secretSentinels[3],
  CLAMAV_HOST: secretSentinels[4],
  UPLOAD_MALWARE_SCAN_MODE: "required"
};
const secretReport = buildNoSpendLaunchPreflight({ env: secretEnv, nowMs: NOW });
const serialized = JSON.stringify(secretReport);
const text = formatText(secretReport);
for (const sentinel of secretSentinels) {
  assert.strictEqual(serialized.includes(sentinel), false, `secret leaked into report: ${sentinel}`);
  assert.strictEqual(text.includes(sentinel), false, `secret leaked into text output: ${sentinel}`);
}
assert.strictEqual(
  secretReport.stages.find((stage) => stage.key === "clamav").ready,
  false,
  "configuration alone must not mark ClamAV launch-ready"
);

const operationalClamav = buildNoSpendLaunchPreflight({
  env: {
    CLAMAV_HOST: "private-clamav.internal",
    UPLOAD_MALWARE_SCAN_MODE: "required",
    CLAMAV_OPERATIONAL_VERIFIED: "true",
    CLAMAV_OPERATIONAL_REVIEWED_AT: "2026-09-14T11:30:00.000Z"
  },
  nowMs: NOW
});
const clamavStage = operationalClamav.stages.find((stage) => stage.key === "clamav");
assert.strictEqual(clamavStage.ready, true);
assert.strictEqual(clamavStage.operationalReview.verified, true);
assert.strictEqual(clamavStage.operationalReview.fresh, true);

const staleClamav = buildNoSpendLaunchPreflight({
  env: {
    CLAMAV_HOST: "private-clamav.internal",
    UPLOAD_MALWARE_SCAN_MODE: "required",
    CLAMAV_OPERATIONAL_VERIFIED: "true",
    CLAMAV_OPERATIONAL_REVIEWED_AT: "2026-01-01T00:00:00.000Z"
  },
  nowMs: NOW
});
assert.strictEqual(
  staleClamav.stages.find((stage) => stage.key === "clamav").ready,
  false
);

console.log("No-spend launch preflight contract passed.");
