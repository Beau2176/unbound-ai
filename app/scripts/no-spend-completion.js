const fs = require("fs");
const path = require("path");
const { buildNoSpendLaunchPreflight } = require("./no-spend-launch-preflight");

const REPO_ROOT = path.resolve(__dirname, "../..");

const REQUIRED_ARTIFACTS = [
  "docs/NO_SPEND_LAUNCH_PREP.md",
  "docs/PROVIDER_APPLICATION_PACKET.md",
  "docs/INFRASTRUCTURE_BASELINE_2026-09-14.md",
  "docs/INCIDENT_RECOVERY.md",
  "docs/LEGAL_DATA_FLOW_REVIEW.md",
  "docs/LAUNCH_REHEARSAL.md",
  "docs/ZERO_COST_LAUNCH_VALIDATION.md",
  "docs/AGE_VERIFICATION.md",
  "docs/BILLING.md",
  "docs/EMAIL_VERIFICATION.md",
  "docs/MALWARE_SCANNING.md",
  "mobile/release-evidence/README.md",
  "mobile/runtime/native-api-transport.js",
  "mobile/runtime/native-validation.js",
  "mobile/scripts/verify-native-api-transport.mjs",
  "mobile/scripts/verify-native-validation.mjs",
  "mobile/scripts/verify-release-evidence-contract.mjs",
  "mobile/scripts/verify-store-shell.mjs"
];

const REQUIRED_APP_SCRIPTS = [
  "check",
  "security-check",
  "regression-check",
  "backup-check",
  "recovery-integration-check",
  "launch-preflight",
  "live-smoke",
  "load-probe",
  "launch-validate"
];

const REQUIRED_MOBILE_SCRIPTS = [
  "build:local-ui",
  "verify:local-ui",
  "verify:native-transport",
  "verify:native-validation",
  "verify:release-evidence-contract",
  "verify:store-config",
  "verify:store-shell",
  "prepare:store"
];

function readJson(relativePath) {
  const absolute = path.join(REPO_ROOT, relativePath);
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function checkArtifacts() {
  return REQUIRED_ARTIFACTS.map((relativePath) => ({
    path: relativePath,
    present: fs.existsSync(path.join(REPO_ROOT, relativePath))
  }));
}

function checkScripts(packagePath, requiredNames) {
  const pkg = readJson(packagePath);
  const scripts = pkg.scripts || {};
  return requiredNames.map((name) => ({
    name,
    present: typeof scripts[name] === "string" && scripts[name].trim().length > 0
  }));
}

function buildNoSpendCompletionReport({ env = process.env, nowMs = Date.now() } = {}) {
  const artifactChecks = checkArtifacts();
  const appScriptChecks = checkScripts("app/package.json", REQUIRED_APP_SCRIPTS);
  const mobileScriptChecks = checkScripts("mobile/package.json", REQUIRED_MOBILE_SCRIPTS);
  const preflight = buildNoSpendLaunchPreflight({ env, nowMs });

  const internalBlockers = [
    ...artifactChecks.filter((item) => !item.present).map((item) => `Missing required artifact: ${item.path}`),
    ...appScriptChecks.filter((item) => !item.present).map((item) => `Missing app script: ${item.name}`),
    ...mobileScriptChecks.filter((item) => !item.present).map((item) => `Missing mobile script: ${item.name}`)
  ];

  const blockedStages = preflight.stages.filter((stage) => !stage.ready);
  const nonExternalStageBlockers = blockedStages
    .filter((stage) => stage.finishRequiresSpendOrExternalApproval !== true)
    .map((stage) => `Blocked stage is not explicitly external: ${stage.key}`);

  internalBlockers.push(...nonExternalStageBlockers);

  const remainingExternalStages = blockedStages.map((stage) => ({
    key: stage.key,
    label: stage.label,
    status: stage.status,
    blockers: Array.isArray(stage.blockers) ? stage.blockers : []
  }));

  const softwarePreparationComplete = internalBlockers.length === 0;

  return {
    profile: "no_spend_completion",
    checkedAt: new Date(nowMs).toISOString(),
    softwarePreparationComplete,
    remainingWorkIsExternalOnly: softwarePreparationComplete,
    internalBlockers,
    artifactChecks,
    appScriptChecks,
    mobileScriptChecks,
    remainingExternalStages,
    launchReady: preflight.eligibleToScheduleFinalRehearsal,
    disclaimer:
      "softwarePreparationComplete means the repository contains the required no-spend engineering, validation, mobile-release, recovery, provider-preparation, and legal-review artifacts. It does not mean external providers, paid infrastructure, banking, counsel, store review, or production evidence are approved or complete."
  };
}

function formatText(report) {
  const lines = [
    "UNBOUND AI — No-spend completion gate",
    `Checked: ${report.checkedAt}`,
    `Software preparation complete: ${report.softwarePreparationComplete ? "YES" : "NO"}`,
    `Remaining work external-only: ${report.remainingWorkIsExternalOnly ? "YES" : "NO"}`,
    ""
  ];

  if (report.internalBlockers.length) {
    lines.push("Internal blockers:");
    for (const blocker of report.internalBlockers) lines.push(`  - ${blocker}`);
    lines.push("");
  }

  lines.push("External/provider/paid stages still blocked:");
  if (!report.remainingExternalStages.length) lines.push("  - none");
  for (const stage of report.remainingExternalStages) {
    lines.push(`  - ${stage.label} (${stage.status})`);
  }
  lines.push("");
  lines.push(report.disclaimer);
  return lines.join("\n");
}

if (require.main === module) {
  const report = buildNoSpendCompletionReport();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatText(report)}\n`);
  }
  if (!report.softwarePreparationComplete) process.exitCode = 1;
}

module.exports = {
  REQUIRED_ARTIFACTS,
  REQUIRED_APP_SCRIPTS,
  REQUIRED_MOBILE_SCRIPTS,
  buildNoSpendCompletionReport,
  formatText
};
