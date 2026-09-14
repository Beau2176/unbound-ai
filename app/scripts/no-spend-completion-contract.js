const assert = require("assert");
const {
  REQUIRED_ARTIFACTS,
  REQUIRED_APP_SCRIPTS,
  REQUIRED_MOBILE_SCRIPTS,
  buildNoSpendCompletionReport,
  formatText
} = require("./no-spend-completion");

const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const report = buildNoSpendCompletionReport({ env: {}, nowMs: NOW });

assert.strictEqual(report.profile, "no_spend_completion");
assert.strictEqual(report.softwarePreparationComplete, true);
assert.strictEqual(report.remainingWorkIsExternalOnly, true);
assert.deepStrictEqual(report.internalBlockers, []);
assert.strictEqual(report.launchReady, false);
assert.strictEqual(report.artifactChecks.length, REQUIRED_ARTIFACTS.length);
assert.strictEqual(report.appScriptChecks.length, REQUIRED_APP_SCRIPTS.length);
assert.strictEqual(report.mobileScriptChecks.length, REQUIRED_MOBILE_SCRIPTS.length);
assert.ok(report.artifactChecks.every((item) => item.present));
assert.ok(report.appScriptChecks.every((item) => item.present));
assert.ok(report.mobileScriptChecks.every((item) => item.present));
assert.deepStrictEqual(
  report.remainingExternalStages.map((stage) => stage.key),
  [
    "infrastructure",
    "backup_restore",
    "business_bank",
    "segpay",
    "yoti",
    "ses",
    "legal",
    "clamav"
  ]
);

const text = formatText(report);
assert.ok(text.includes("Software preparation complete: YES"));
assert.ok(text.includes("Remaining work external-only: YES"));
assert.ok(text.includes("Infrastructure"));
assert.ok(text.includes("Segpay"));
assert.ok(text.includes("Yoti"));
assert.ok(text.includes("Amazon SES"));
assert.ok(text.includes("Final legal review"));
assert.ok(text.includes("ClamAV"));

const secretSentinels = [
  "AWS-SECRET-SENTINEL",
  "SEGPAY-SECRET-SENTINEL",
  "YOTI-SECRET-SENTINEL",
  "DATABASE-SECRET-SENTINEL"
];
const secretReport = buildNoSpendCompletionReport({
  env: {
    AWS_SECRET_ACCESS_KEY: secretSentinels[0],
    SEGPAY_SIGNING_KEY: secretSentinels[1],
    YOTI_API_KEY: secretSentinels[2],
    DATABASE_URL: secretSentinels[3]
  },
  nowMs: NOW
});
const serialized = JSON.stringify(secretReport);
for (const sentinel of secretSentinels) {
  assert.strictEqual(serialized.includes(sentinel), false, `secret leaked into completion report: ${sentinel}`);
}

console.log("No-spend completion gate contract passed.");
