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

async function main() {
  assert(REHEARSAL_STEPS.length >= 15, "rehearsal should cover the complete customer/operations launch path");
  assert(REHEARSAL_STEPS.some((step) => step.key === "premium_checkout"));
  assert(REHEARSAL_STEPS.some((step) => step.key === "ultra_checkout"));
  for (const [plan, price] of [["premium", "49.99"], ["ultra", "129.99"], ["unlimited", "299.99"]]) {
    const step = REHEARSAL_STEPS.find(step => step.key === `${plan}_checkout`);
    assert(step?.required, `${plan} must be covered at initial launch`);
    assert(step.label.includes(`$${price}`));
    assert(step.dependencies.includes("segpay") && step.dependencies.includes("business_bank"));
    assert.strictEqual(step.mayUsePaidProvider, true);
  }
  assert(!REHEARSAL_STEPS.some(step => step.key === "max_checkout"), "Max remains outside the initial launch");
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

  const pastResults = catalog.steps.map(step => ({
    step_key: step.key,
    status: "pass",
    evidence_note: "Previously verified with all prerequisites ready",
    tested_at: "2026-09-13T13:30:00Z"
  }));
  const drifted = buildRehearsalRunSummary({ catalogState: catalog, results: pastResults });
  assert.strictEqual(drifted.eligibleToFinalize, false, "Past PASS results cannot override current blocked prerequisites");
  const driftedPremium = drifted.steps.find(step => step.key === "premium_checkout");
  assert.strictEqual(driftedPremium.status, "blocked");
  assert.strictEqual(driftedPremium.storedStatus, "pass", "Preserve the historical result separately");
  assert.strictEqual(driftedPremium.evidenceNote, pastResults.find(step => step.step_key === "premium_checkout").evidence_note);
  assert.strictEqual(drifted.steps.find(step => step.key === "public_runtime").status, "pass");
  const readyCatalog = {
    ...catalog,
    externalPrerequisitesReady: true,
    steps: catalog.steps.map(step => ({ ...step, dependencyReady: true, blockedBy: [] }))
  };
  const readySummary = buildRehearsalRunSummary({ catalogState: readyCatalog, results: pastResults });
  assert.strictEqual(readySummary.eligibleToFinalize, true);
  assert.strictEqual(readySummary.completionPercent, 100);
  assert.strictEqual(buildRehearsalRunSummary({
    catalogState: { ...readyCatalog, externalPrerequisitesReady: false }, results: pastResults
  }).eligibleToFinalize, false, "The complete current preflight must also be ready");
  const failedResults = pastResults.map(item => item.step_key === "premium_checkout" ? { ...item, status: "fail" } : item);
  assert.strictEqual(buildRehearsalRunSummary({ catalogState: catalog, results: failedResults })
    .steps.find(step => step.key === "premium_checkout").status, "fail", "Keep explicit failure evidence visible");

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

  // Execute the actual integrated finalization route against historical PASS
  // records and a current dependency snapshot. No database/provider is called.
  const routeStart = integrated.indexOf('app.post(\n  "/api/admin/ops/launch-rehearsal/runs/:id/finalize"');
  const routeEnd = integrated.indexOf('app.get(\n  "/api/admin/ops/launch-rehearsal/runs/:id/export"', routeStart);
  assert(routeStart >= 0 && routeEnd > routeStart);
  async function finalize(catalogState, results) {
    let handler;
    let updates = 0;
    let audits = 0;
    let status = 200;
    let payload;
    const run = { id: "7", status: "in_progress" };
    vm.runInNewContext(integrated.slice(routeStart, routeEnd), {
      app: { post(_path, ...handlers) { handler = handlers.at(-1); } },
      requireDatabase() {}, requireAdmin() {}, securityActionRateLimit() {},
      pool: { async query(sql) {
        if (sql.includes("SELECT * FROM launch_rehearsal_runs")) return { rows: [run] };
        if (sql.includes("SELECT * FROM launch_rehearsal_step_results")) return { rows: results };
        assert(sql.includes("UPDATE launch_rehearsal_runs"));
        updates += 1;
        return { rows: [{ ...run, status: "completed" }] };
      } },
      buildRehearsalCatalogState: () => catalogState,
      buildRehearsalRunSummary,
      writeAdminAudit: async () => { audits += 1; },
      console
    });
    await handler({ params: { id: "7" }, user: { id: "1" } }, {
      status(value) { status = value; return this; },
      json(value) { payload = value; return this; }
    });
    return { status, payload, updates, audits };
  }
  for (const blocked of [catalog, { ...readyCatalog, externalPrerequisitesReady: false }]) {
    const denied = await finalize(blocked, pastResults);
    assert.strictEqual(denied.status, 409, "Current blocked prerequisites must prevent finalization in the real route");
    assert.strictEqual(denied.updates, 0);
    assert.strictEqual(denied.audits, 0);
    assert.strictEqual(denied.payload.summary.eligibleToFinalize, false);
  }
  const incomplete = await finalize(readyCatalog, pastResults.slice(1));
  assert.strictEqual(incomplete.status, 409);
  assert.strictEqual(incomplete.updates, 0);
  const completed = await finalize(readyCatalog, pastResults);
  assert.strictEqual(completed.status, 200);
  assert.strictEqual(completed.updates, 1);
  assert.strictEqual(completed.audits, 1);
  assert.strictEqual(completed.payload.run.status, "completed");

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

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
