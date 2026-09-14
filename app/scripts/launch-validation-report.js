"use strict";

const fs = require("fs");
const path = require("path");
const { buildNoSpendLaunchPreflight } = require("./no-spend-launch-preflight");
const { runLiveSmokeCheck } = require("./live-smoke-check");
const { runSafeLoadProbe } = require("./safe-load-probe");

function parseArgs(argv = process.argv.slice(2)) {
  const result = {
    origin: null,
    requireReady: false,
    runLoad: false,
    allowRemoteLoad: false,
    requests: undefined,
    concurrency: undefined,
    delayMs: undefined,
    path: undefined,
    json: false,
    output: null
  };
  for (const arg of argv) {
    if (arg === "--json") result.json = true;
    else if (arg === "--require-ready") result.requireReady = true;
    else if (arg === "--load") result.runLoad = true;
    else if (arg === "--allow-remote-load") result.allowRemoteLoad = true;
    else if (arg.startsWith("--origin=")) result.origin = arg.slice("--origin=".length);
    else if (arg.startsWith("--requests=")) result.requests = Number.parseInt(arg.slice("--requests=".length), 10);
    else if (arg.startsWith("--concurrency=")) result.concurrency = Number.parseInt(arg.slice("--concurrency=".length), 10);
    else if (arg.startsWith("--delay-ms=")) result.delayMs = Number.parseInt(arg.slice("--delay-ms=".length), 10);
    else if (arg.startsWith("--path=")) result.path = arg.slice("--path=".length);
    else if (arg.startsWith("--output=")) result.output = arg.slice("--output=".length);
  }
  return result;
}

function safeOutputPath(value) {
  if (!value) return null;
  const resolved = path.resolve(process.cwd(), String(value));
  const cwd = path.resolve(process.cwd());
  if (resolved !== cwd && !resolved.startsWith(`${cwd}${path.sep}`)) {
    throw new Error("Validation output path must stay inside the current working directory.");
  }
  if (!resolved.toLowerCase().endsWith(".json")) {
    throw new Error("Validation output file must use a .json extension.");
  }
  return resolved;
}

async function buildLaunchValidationReport({
  env = process.env,
  nowMs = Date.now(),
  origin = null,
  requireReady = false,
  runLoad = false,
  allowRemoteLoad = false,
  requests,
  concurrency,
  delayMs,
  path: probePath,
  fetchImpl = fetch
} = {}) {
  const preflight = buildNoSpendLaunchPreflight({ env, nowMs });
  let smoke = null;
  let load = null;

  if (origin) {
    smoke = await runLiveSmokeCheck({
      origin,
      requireReady,
      fetchImpl
    });
  }

  if (runLoad) {
    if (!origin) throw new Error("--load requires an explicit --origin.");
    load = await runSafeLoadProbe({
      origin,
      path: probePath,
      requests,
      concurrency,
      delayMs,
      allowRemote: allowRemoteLoad,
      fetchImpl
    });
  }

  const codeAndRuntimeChecksPassed = smoke
    ? Boolean(smoke.passed && (!load || load.summary.passed))
    : null;

  return {
    profile: "zero_cost_launch_validation",
    generatedAt: new Date(nowMs).toISOString(),
    launchReady: Boolean(
      preflight.eligibleToScheduleFinalRehearsal &&
      codeAndRuntimeChecksPassed === true &&
      smoke &&
      smoke.passed &&
      (!requireReady || smoke.checks.every((check) => check.ready !== false))
    ),
    codeAndRuntimeChecksPassed,
    externalPrerequisitesReady: preflight.eligibleToScheduleFinalRehearsal,
    preflight,
    smoke,
    load,
    disclaimer:
      "A green smoke/load result does not override blocked banking, provider, legal, malware-scanner, infrastructure, or recovery prerequisites. External readiness remains fail-closed until independently verified."
  };
}

function formatText(report) {
  const runtimeLabel = report.codeAndRuntimeChecksPassed === null
    ? "NOT RUN"
    : report.codeAndRuntimeChecksPassed
      ? "PASS"
      : "FAIL";
  const lines = [
    "UNBOUND AI — Zero-cost launch validation",
    `Generated: ${report.generatedAt}`,
    `Code/runtime checks: ${runtimeLabel}`,
    `External prerequisites: ${report.externalPrerequisitesReady ? "PASS" : "BLOCKED"}`,
    `Commercial launch ready: ${report.launchReady ? "YES" : "NO"}`,
    ""
  ];
  for (const stage of report.preflight.stages) {
    lines.push(`${stage.ready ? "PASS" : "BLOCKED"}  ${stage.label}`);
  }
  if (report.smoke) {
    lines.push("");
    lines.push(`Live smoke: ${report.smoke.passed ? "PASS" : "FAIL"} (${report.smoke.checksPassed}/${report.smoke.checks.length})`);
  }
  if (report.load) {
    lines.push(`Safe load probe: ${report.load.summary.passed ? "PASS" : "FAIL"} (${report.load.summary.successes}/${report.load.summary.requests})`);
    lines.push(`Load p95: ${report.load.summary.latencyMs.p95 ?? "n/a"} ms`);
  }
  lines.push("");
  lines.push(report.disclaimer);
  return lines.join("\n");
}

if (require.main === module) {
  const args = parseArgs();
  buildLaunchValidationReport(args)
    .then((report) => {
      const outputPath = safeOutputPath(args.output);
      if (outputPath) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      }
      process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatText(report)}\n`);
      if (args.origin && report.codeAndRuntimeChecksPassed === false) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error?.message || error);
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  safeOutputPath,
  buildLaunchValidationReport,
  formatText
};
