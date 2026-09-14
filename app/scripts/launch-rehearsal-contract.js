"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  REHEARSAL_STEPS,
  buildRehearsalCatalogState,
  canRecordStepStatus,
  requireEvidenceForStatus,
  buildRehearsalRunSummary
} = require("../ops/launch-rehearsal");
const { integrateLaunchDashboardServerSource } = require("../ops/launch-dashboard-server-integration");
const { integrateAdminThreeTierServerSource } = require("../access/admin-three-tier-server-integration");
const { integrateLaunchRehearsalServerSource } = require("../ops/launch-rehearsal-server-integration");

function main() {
  assert(REHEARSAL_STEPS.length >= 15, "rehearsal should cover the complete customer/operations launch path");
  assert(REHEARSAL_STEPS.some((step) => step.key === "premium_checkout"));
  assert(REHEARSAL_STEPS.some((step) => step.key === "ultra_checkout"));
  assert(REHEARSAL_STEPS.some((step) => step.key === "hard_age_verification"));
  assert(REHEARSAL_STEPS.some((step) => step.key === "adult_mode_security"));
  assert(REHEARSAL_STEPS.some((step) => step.key === "media_workflows"));
  assert(REHEARSAL_STEPS.some((step) => step.key === "backup_restore"));

  const catalog = buildRehearsalCatalogState({ env: {}, nowMs: Date.parse("2026-09-14T13:30:00Z") });
  const runtime = catalog.steps.find((step) => step.key === "public_runtime");
  const premium = catalog.steps.find((step) => step.key === "premium_checkout");
  const yoti = catalog.steps.find((step) => step.key === "hard_age_verification");
  assert.strictEqual(runtime.dependencyReady, true, "in-house runtime test should be recordable without external approval");
  assert.strictEqual(premium.dependencyReady, false, "Premium checkout must stay blocked without Segpay/banking readiness");
  assert.strictEqual(yoti.dependencyReady, false, "hard age verification must stay blocked without Yoti readiness");
  assert.strictEqual(canRecordStepStatus(runtime, "pass").allowed, true);
  assert.strictEqual(canRecordStepStatus(premium, "pass").allowed, false);
  assert.strictEqual(canRecordStepStatus(premium, "blocked").allowed, true);
  assert.strictEqual(requireEvidenceForStatus("pass", "too short"), true);
  assert.strictEqual(requireEvidenceForStatus("pass", "short"), false);
  assert.strictEqual(requireEvidenceForStatus("fail", "failure evidence recorded"), true);

  const summary = buildRehearsalRunSummary({ catalogState: catalog, results: [] });
  assert.strictEqual(summary.eligibleToFinalize, false);
  assert(summary.counts.blocked > 0, "blocked dependencies should appear blocked even before a manual result is stored");
  assert.strictEqual(summary.externalPrerequisitesReady, false);

  const rawServer = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  let integrated = integrateLaunchDashboardServerSource(rawServer);
  integrated = integrateAdminThreeTierServerSource(integrated);
  integrated = integrateLaunchRehearsalServerSource(integrated);
  assert.match(integrated, /CREATE TABLE IF NOT EXISTS launch_rehearsal_runs/);
  assert.match(integrated, /CREATE TABLE IF NOT EXISTS launch_rehearsal_step_results/);
  assert.match(integrated, /\/api\/admin\/ops\/launch-rehearsal\/catalog/);
  assert.match(integrated, /\/api\/admin\/ops\/launch-rehearsal\/runs/);
  assert.match(integrated, /canRecordStepStatus\(step, status\)/);
  assert.match(integrated, /Only an in-progress rehearsal can be changed/);
  assert.match(integrated, /every required step is PASS/i);
  assert.match(integrated, /Completed rehearsal evidence does not independently authorize commercial launch/);
  assert.match(integrated, /requireAdmin/);
  assert.match(integrated, /writeAdminAudit/);
  assert.match(integrated, /Content-Disposition/);
  assert.strictEqual(integrateLaunchRehearsalServerSource(integrated), integrated, "rehearsal integration must be idempotent");
  new vm.Script(integrated, { filename: "integrated-launch-rehearsal-server.js" });

  const ui = fs.readFileSync(path.join(__dirname, "..", "launch-rehearsal.html"), "utf8");
  assert.match(ui, /Evidence, not permission/i);
  assert.match(ui, /Provider-dependent steps cannot be marked PASS/i);
  assert.match(ui, /DOWNLOAD JSON EVIDENCE/);
  assert.match(ui, /FINALIZE REHEARSAL/);
  assert.doesNotMatch(ui, /\/api\/billing\/checkout|\/api\/age-verification\/start|\/api\/email\/verification\/send/i,
    "rehearsal workspace must record evidence, not invoke paid/external workflows automatically");

  const startup = fs.readFileSync(path.join(__dirname, "..", "start.js"), "utf8");
  assert.match(startup, /integrateLaunchRehearsalServerSource/);
  assert.ok(
    startup.indexOf("integrateLaunchDashboardServerSource(integratedSource)") <
      startup.indexOf("integrateLaunchRehearsalServerSource(integratedSource)"),
    "launch dashboard must establish owner readiness before rehearsal integration"
  );

  console.log("Launch rehearsal contract passed: persistent audited evidence, fail-closed dependencies, and no automatic provider execution.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
