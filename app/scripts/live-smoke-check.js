"use strict";

const { performance } = require("perf_hooks");

const DEFAULT_ORIGIN = "http://127.0.0.1:3000";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TIMEOUT_MS = 30000;

const PUBLIC_CHECKS = Object.freeze([
  { key: "health", path: "/healthz", statuses: [200], kind: "json" },
  { key: "readiness", path: "/readyz", statuses: [200, 503], kind: "json", readiness: true },
  { key: "system_status", path: "/api/system/status", statuses: [200, 503], kind: "json", readiness: true },
  {
    key: "homepage",
    path: "/",
    statuses: [200],
    kind: "text",
    contentType: "text/html",
    markers: ["UNBOUND AI", "adult-step-up.js?v=095", "voice-media-shortcuts.js?v=20260914"]
  },
  { key: "adult_step_up_script", path: "/adult-step-up.js", statuses: [200], kind: "text", contentType: "javascript" },
  { key: "media_capture_script", path: "/media-capture.js", statuses: [200], kind: "text", contentType: "javascript" },
  { key: "media_shortcuts_script", path: "/voice-media-shortcuts.js", statuses: [200], kind: "text", contentType: "javascript" },
  { key: "terms", path: "/terms.html", statuses: [200], kind: "text", contentType: "text/html" },
  { key: "privacy", path: "/privacy.html", statuses: [200], kind: "text", contentType: "text/html" }
]);

function parseArgs(argv = process.argv.slice(2)) {
  const result = {
    origin: process.env.UNBOUND_SMOKE_ORIGIN || DEFAULT_ORIGIN,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    requireReady: false,
    json: false
  };
  for (const arg of argv) {
    if (arg === "--json") result.json = true;
    else if (arg === "--require-ready") result.requireReady = true;
    else if (arg.startsWith("--origin=")) result.origin = arg.slice("--origin=".length);
    else if (arg.startsWith("--timeout-ms=")) {
      const parsed = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
      if (Number.isFinite(parsed)) result.timeoutMs = Math.max(500, Math.min(MAX_TIMEOUT_MS, parsed));
    }
  }
  return result;
}

function normalizeOrigin(value) {
  const url = new URL(String(value || DEFAULT_ORIGIN));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Smoke-check origin must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Smoke-check origin must not contain embedded credentials.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const started = performance.now();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/json,application/javascript,text/javascript;q=0.9,*/*;q=0.1",
        "User-Agent": "UNBOUND-AI-Zero-Cost-Smoke-Check/1.0"
      },
      signal: controller.signal
    });
    return { response, latencyMs: Math.round((performance.now() - started) * 10) / 10 };
  } finally {
    clearTimeout(timer);
  }
}

function readinessFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.ready === "boolean") return payload.ready;
  if (typeof payload.live === "boolean") return payload.live;
  if (typeof payload.ok === "boolean") return payload.ok;
  if (typeof payload.status === "string") {
    const normalized = payload.status.toLowerCase();
    if (["ready", "ok", "healthy", "live"].includes(normalized)) return true;
    if (["not_ready", "not-ready", "degraded", "unavailable", "offline"].includes(normalized)) return false;
  }
  return null;
}

async function runCheck(origin, check, options = {}) {
  const url = new URL(check.path, `${origin}/`).toString();
  try {
    const { response, latencyMs } = await fetchWithTimeout(url, options);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    let bodyText = "";
    let payload = null;
    let parseError = null;
    if (check.kind === "json") {
      bodyText = await response.text();
      try { payload = JSON.parse(bodyText); } catch (error) { parseError = error; }
    } else {
      bodyText = await response.text();
    }

    const failures = [];
    if (!check.statuses.includes(response.status)) failures.push(`unexpected status ${response.status}`);
    if (check.contentType && !contentType.includes(check.contentType)) {
      failures.push(`unexpected content-type ${contentType || "missing"}`);
    }
    if (check.kind === "json" && parseError) failures.push("response was not valid JSON");
    for (const marker of check.markers || []) {
      if (!bodyText.includes(marker)) failures.push(`missing marker: ${marker}`);
    }

    const ready = check.readiness ? readinessFromPayload(payload) : null;
    if (check.readiness && options.requireReady && ready !== true) {
      failures.push("runtime reported not ready");
    }

    return {
      key: check.key,
      path: check.path,
      method: "GET",
      status: response.status,
      contentType: contentType || null,
      latencyMs,
      ready,
      passed: failures.length === 0,
      failures
    };
  } catch (error) {
    return {
      key: check.key,
      path: check.path,
      method: "GET",
      status: null,
      contentType: null,
      latencyMs: null,
      ready: null,
      passed: false,
      failures: [error?.name === "AbortError" ? "request timed out" : String(error?.message || error)]
    };
  }
}

async function runLiveSmokeCheck({
  origin = DEFAULT_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  requireReady = false,
  fetchImpl = fetch,
  checks = PUBLIC_CHECKS
} = {}) {
  const normalizedOrigin = normalizeOrigin(origin);
  const startedAt = new Date().toISOString();
  const results = [];
  for (const check of checks) {
    results.push(await runCheck(normalizedOrigin, check, {
      timeoutMs,
      requireReady,
      fetchImpl
    }));
  }
  const failed = results.filter((item) => !item.passed);
  return {
    profile: "zero_cost_live_smoke_check",
    origin: normalizedOrigin,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestPolicy: {
      methods: ["GET"],
      mutatingRequests: false,
      aiProviderCalls: false,
      billingCalls: false,
      ageVerificationCalls: false
    },
    requireReady,
    passed: failed.length === 0,
    checksPassed: results.length - failed.length,
    checksFailed: failed.length,
    checks: results,
    disclaimer:
      "This is a public, non-mutating smoke check. It does not prove provider approval, payment readiness, legal approval, production capacity, or launch readiness by itself."
  };
}

function formatText(report) {
  const lines = [
    "UNBOUND AI — Zero-cost live smoke check",
    `Origin: ${report.origin}`,
    `Result: ${report.passed ? "PASS" : "FAIL"}`,
    ""
  ];
  for (const check of report.checks) {
    const latency = check.latencyMs === null ? "n/a" : `${check.latencyMs}ms`;
    lines.push(`${check.passed ? "PASS" : "FAIL"}  ${check.path}  ${check.status ?? "ERR"}  ${latency}`);
    for (const failure of check.failures || []) lines.push(`  - ${failure}`);
  }
  lines.push("");
  lines.push(report.disclaimer);
  return lines.join("\n");
}

if (require.main === module) {
  const args = parseArgs();
  runLiveSmokeCheck(args)
    .then((report) => {
      process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatText(report)}\n`);
      if (!report.passed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error?.stack || error);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_ORIGIN,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  PUBLIC_CHECKS,
  parseArgs,
  normalizeOrigin,
  fetchWithTimeout,
  readinessFromPayload,
  runCheck,
  runLiveSmokeCheck,
  formatText
};
