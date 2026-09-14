"use strict";

const { performance } = require("perf_hooks");
const { normalizeOrigin, fetchWithTimeout } = require("./live-smoke-check");

const DEFAULT_ORIGIN = "http://127.0.0.1:3000";
const DEFAULT_PATH = "/healthz";
const DEFAULT_REQUESTS = 20;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_DELAY_MS = 50;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_REQUESTS = 200;
const MAX_CONCURRENCY = 10;
const MAX_DELAY_MS = 5000;
const SAFE_PATHS = Object.freeze(["/healthz", "/readyz", "/api/system/status", "/"]);

function isLoopbackHost(hostname) {
  const value = String(hostname || "").toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

function parsePositiveInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseArgs(argv = process.argv.slice(2)) {
  const result = {
    origin: process.env.UNBOUND_LOAD_ORIGIN || DEFAULT_ORIGIN,
    path: DEFAULT_PATH,
    requests: DEFAULT_REQUESTS,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    allowRemote: false,
    json: false
  };
  for (const arg of argv) {
    if (arg === "--json") result.json = true;
    else if (arg === "--allow-remote") result.allowRemote = true;
    else if (arg.startsWith("--origin=")) result.origin = arg.slice("--origin=".length);
    else if (arg.startsWith("--path=")) result.path = arg.slice("--path=".length);
    else if (arg.startsWith("--requests=")) {
      result.requests = parsePositiveInteger(arg.slice("--requests=".length), DEFAULT_REQUESTS, 1, MAX_REQUESTS);
    } else if (arg.startsWith("--concurrency=")) {
      result.concurrency = parsePositiveInteger(arg.slice("--concurrency=".length), DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY);
    } else if (arg.startsWith("--delay-ms=")) {
      result.delayMs = parsePositiveInteger(arg.slice("--delay-ms=".length), DEFAULT_DELAY_MS, 0, MAX_DELAY_MS);
    } else if (arg.startsWith("--timeout-ms=")) {
      result.timeoutMs = parsePositiveInteger(arg.slice("--timeout-ms=".length), DEFAULT_TIMEOUT_MS, 500, 30000);
    }
  }
  return result;
}

function validateProbeTarget({ origin, path, allowRemote = false }) {
  const normalizedOrigin = normalizeOrigin(origin);
  const parsed = new URL(normalizedOrigin);
  if (!SAFE_PATHS.includes(path)) {
    throw new Error(`Load probe path is not allowed. Allowed paths: ${SAFE_PATHS.join(", ")}`);
  }
  if (!isLoopbackHost(parsed.hostname) && !allowRemote) {
    throw new Error(
      "Remote load probes are blocked by default. Pass --allow-remote only when you are authorized to test that service."
    );
  }
  return normalizedOrigin;
}

function percentile(sortedValues, quantile) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function runSafeLoadProbe({
  origin = DEFAULT_ORIGIN,
  path = DEFAULT_PATH,
  requests = DEFAULT_REQUESTS,
  concurrency = DEFAULT_CONCURRENCY,
  delayMs = DEFAULT_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  allowRemote = false,
  fetchImpl = fetch
} = {}) {
  const normalizedOrigin = validateProbeTarget({ origin, path, allowRemote });
  const requestCount = parsePositiveInteger(requests, DEFAULT_REQUESTS, 1, MAX_REQUESTS);
  const workerCount = Math.min(
    parsePositiveInteger(concurrency, DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY),
    requestCount
  );
  const boundedDelay = parsePositiveInteger(delayMs, DEFAULT_DELAY_MS, 0, MAX_DELAY_MS);
  const targetUrl = new URL(path, `${normalizedOrigin}/`).toString();
  const results = new Array(requestCount);
  let cursor = 0;
  const started = performance.now();
  const startedAt = new Date().toISOString();

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= requestCount) return;
      if (index > 0 && boundedDelay > 0) await sleep(boundedDelay);
      try {
        const { response, latencyMs } = await fetchWithTimeout(targetUrl, {
          timeoutMs,
          fetchImpl
        });
        await response.arrayBuffer();
        const passed = response.status >= 200 && response.status < 400;
        results[index] = {
          index: index + 1,
          status: response.status,
          latencyMs,
          passed,
          error: passed ? null : `unhealthy HTTP status ${response.status}`
        };
      } catch (error) {
        results[index] = {
          index: index + 1,
          status: null,
          latencyMs: null,
          passed: false,
          error: error?.name === "AbortError" ? "request timed out" : String(error?.message || error)
        };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const durationMs = performance.now() - started;
  const successful = results.filter((item) => item?.passed);
  const failed = results.filter((item) => !item?.passed);
  const latencies = successful
    .map((item) => Number(item.latencyMs))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const statuses = {};
  for (const item of results) {
    const key = item?.status === null ? "ERR" : String(item.status);
    statuses[key] = (statuses[key] || 0) + 1;
  }

  return {
    profile: "zero_cost_safe_load_probe",
    origin: normalizedOrigin,
    path,
    startedAt,
    finishedAt: new Date().toISOString(),
    policy: {
      method: "GET",
      successfulHttpStatuses: "200-399",
      safePaths: SAFE_PATHS,
      remoteRequiresExplicitAllow: true,
      maxRequests: MAX_REQUESTS,
      maxConcurrency: MAX_CONCURRENCY,
      providerEndpointsExcluded: true,
      mutatingEndpointsExcluded: true
    },
    configuration: {
      requests: requestCount,
      concurrency: workerCount,
      delayMs: boundedDelay,
      timeoutMs
    },
    summary: {
      passed: failed.length === 0,
      requests: requestCount,
      successes: successful.length,
      failures: failed.length,
      durationMs: round(durationMs),
      observedRequestsPerSecond: durationMs > 0 ? round(requestCount / (durationMs / 1000), 2) : null,
      latencyMs: {
        min: latencies.length ? round(latencies[0]) : null,
        median: round(percentile(latencies, 0.5)),
        p95: round(percentile(latencies, 0.95)),
        max: latencies.length ? round(latencies[latencies.length - 1]) : null
      },
      statuses
    },
    failures: failed.map((item) => ({ index: item.index, status: item.status, error: item.error })),
    disclaimer:
      "This is a deliberately bounded capacity probe, not a stress test. Results from Free infrastructure are only a baseline and must not be treated as final production sizing evidence."
  };
}

function formatText(report) {
  const s = report.summary;
  return [
    "UNBOUND AI — Zero-cost safe load probe",
    `Target: ${report.origin}${report.path}`,
    `Requests: ${s.requests} | Concurrency: ${report.configuration.concurrency}`,
    `Result: ${s.passed ? "PASS" : "FAIL"} | Success: ${s.successes} | Failures: ${s.failures}`,
    `Observed rate: ${s.observedRequestsPerSecond ?? "n/a"} req/s`,
    `Latency ms: min ${s.latencyMs.min ?? "n/a"} | median ${s.latencyMs.median ?? "n/a"} | p95 ${s.latencyMs.p95 ?? "n/a"} | max ${s.latencyMs.max ?? "n/a"}`,
    `Statuses: ${Object.entries(s.statuses).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
    "",
    report.disclaimer
  ].join("\n");
}

if (require.main === module) {
  const args = parseArgs();
  runSafeLoadProbe(args)
    .then((report) => {
      process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatText(report)}\n`);
      if (!report.summary.passed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error?.message || error);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_ORIGIN,
  DEFAULT_PATH,
  DEFAULT_REQUESTS,
  DEFAULT_CONCURRENCY,
  DEFAULT_DELAY_MS,
  MAX_REQUESTS,
  MAX_CONCURRENCY,
  SAFE_PATHS,
  isLoopbackHost,
  parsePositiveInteger,
  parseArgs,
  validateProbeTarget,
  percentile,
  runSafeLoadProbe,
  formatText
};
