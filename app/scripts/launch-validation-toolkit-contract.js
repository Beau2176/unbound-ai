"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  PUBLIC_CHECKS,
  runLiveSmokeCheck,
  normalizeOrigin
} = require("./live-smoke-check");
const {
  MAX_REQUESTS,
  MAX_CONCURRENCY,
  SAFE_PATHS,
  parsePositiveInteger,
  validateProbeTarget,
  runSafeLoadProbe
} = require("./safe-load-probe");
const {
  safeOutputPath,
  buildLaunchValidationReport
} = require("./launch-validation-report");

function fakeFetch(url, options = {}) {
  const parsed = new URL(url);
  assert.strictEqual(options.method, "GET", "validation network traffic must be GET-only");
  if (parsed.pathname === "/") {
    return Promise.resolve(new Response(
      '<html><head><title>UNBOUND AI</title></head><body>UNBOUND AI<script src="/adult-step-up.js?v=095"></script><script src="/voice-media-shortcuts.js?v=20260914"></script></body></html>',
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
    ));
  }
  if (["/healthz", "/readyz", "/api/system/status"].includes(parsed.pathname)) {
    return Promise.resolve(new Response(JSON.stringify({ live: true, ready: true, status: "ready" }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    }));
  }
  if (["/adult-step-up.js", "/media-capture.js", "/voice-media-shortcuts.js"].includes(parsed.pathname)) {
    return Promise.resolve(new Response("(() => {})();", {
      status: 200,
      headers: { "content-type": "application/javascript; charset=utf-8" }
    }));
  }
  if (["/terms.html", "/privacy.html"].includes(parsed.pathname)) {
    return Promise.resolve(new Response("<!doctype html><title>UNBOUND AI</title>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    }));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

async function main() {
  assert.strictEqual(normalizeOrigin("http://127.0.0.1:3000/path?q=1"), "http://127.0.0.1:3000");
  assert.throws(() => normalizeOrigin("file:///tmp/unbound"), /http or https/i);
  assert.throws(() => normalizeOrigin("https://user:pass@example.com"), /credentials/i);

  assert(PUBLIC_CHECKS.length >= 8, "smoke check should cover the public application shell");
  assert(PUBLIC_CHECKS.every((item) => item.path.startsWith("/")));
  assert(PUBLIC_CHECKS.every((item) => !item.path.includes("chat")));
  assert(PUBLIC_CHECKS.every((item) => !item.path.includes("billing")));
  assert(PUBLIC_CHECKS.every((item) => !item.path.includes("webhook")));

  const smoke = await runLiveSmokeCheck({
    origin: "http://127.0.0.1:3000",
    requireReady: true,
    fetchImpl: fakeFetch
  });
  assert.strictEqual(smoke.passed, true);
  assert.strictEqual(smoke.requestPolicy.mutatingRequests, false);
  assert.strictEqual(smoke.requestPolicy.aiProviderCalls, false);
  assert.strictEqual(smoke.requestPolicy.billingCalls, false);
  assert.strictEqual(smoke.requestPolicy.ageVerificationCalls, false);

  assert.deepStrictEqual(SAFE_PATHS, ["/healthz", "/readyz", "/api/system/status", "/"]);
  assert.strictEqual(MAX_REQUESTS, 200);
  assert.strictEqual(MAX_CONCURRENCY, 10);
  assert.strictEqual(parsePositiveInteger(9999, 20, 1, MAX_REQUESTS), MAX_REQUESTS);
  assert.strictEqual(parsePositiveInteger(9999, 2, 1, MAX_CONCURRENCY), MAX_CONCURRENCY);
  assert.throws(
    () => validateProbeTarget({ origin: "https://example.com", path: "/healthz", allowRemote: false }),
    /--allow-remote/i
  );
  assert.strictEqual(
    validateProbeTarget({ origin: "https://example.com", path: "/healthz", allowRemote: true }),
    "https://example.com"
  );
  assert.throws(
    () => validateProbeTarget({ origin: "http://127.0.0.1:3000", path: "/api/chat/stream", allowRemote: false }),
    /not allowed/i
  );

  const load = await runSafeLoadProbe({
    origin: "http://127.0.0.1:3000",
    path: "/healthz",
    requests: 5,
    concurrency: 2,
    delayMs: 0,
    fetchImpl: fakeFetch
  });
  assert.strictEqual(load.summary.passed, true);
  assert.strictEqual(load.summary.requests, 5);
  assert.strictEqual(load.summary.successes, 5);
  assert.strictEqual(load.policy.remoteRequiresExplicitAllow, true);
  assert.strictEqual(load.policy.providerEndpointsExcluded, true);
  assert.strictEqual(load.policy.mutatingEndpointsExcluded, true);

  const report = await buildLaunchValidationReport({
    env: {},
    origin: "http://127.0.0.1:3000",
    requireReady: true,
    fetchImpl: fakeFetch
  });
  assert.strictEqual(report.codeAndRuntimeChecksPassed, true);
  assert.strictEqual(report.externalPrerequisitesReady, false);
  assert.strictEqual(report.launchReady, false, "live health must never override external launch blockers");

  assert(safeOutputPath("validation-report.json").endsWith(`${path.sep}validation-report.json`));
  assert.throws(() => safeOutputPath("../outside.json"), /current working directory/i);
  assert.throws(() => safeOutputPath("validation-report.txt"), /\.json extension/i);

  const smokeSource = fs.readFileSync(path.join(__dirname, "live-smoke-check.js"), "utf8");
  const loadSource = fs.readFileSync(path.join(__dirname, "safe-load-probe.js"), "utf8");
  const reportSource = fs.readFileSync(path.join(__dirname, "launch-validation-report.js"), "utf8");
  for (const source of [smokeSource, loadSource, reportSource]) {
    assert.doesNotMatch(source, /method:\s*["']POST["']/i, "validation toolkit must not send POST requests");
    assert.doesNotMatch(source, /method:\s*["']PUT["']|method:\s*["']PATCH["']|method:\s*["']DELETE["']/i,
      "validation toolkit must not send mutating requests");
    assert.doesNotMatch(source, /\/api\/chat(?:\/|["'])/i, "validation toolkit must not invoke AI chat/provider work");
    assert.doesNotMatch(source, /\/api\/webhooks\//i, "validation toolkit must not invoke provider webhooks");
  }

  console.log("Zero-cost launch validation toolkit contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
