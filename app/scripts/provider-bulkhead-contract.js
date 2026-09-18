const assert = require("assert");
const fs = require("fs");
const path = require("path");
const google = require("../ai/providers/google");
const anthropic = require("../ai/providers/anthropic");
const openai = require("../ai/providers/openai");
const {
  generateChat,
  streamChat,
  analyzeFile,
  getGatewayStatus,
  isRetryableProviderError
} = require("../ai/gateway");
const {
  DEFAULT_PROVIDER_BULKHEAD_POLICY,
  getProviderBulkheadPolicy,
  acquireProviderBulkheadSlot,
  runWithProviderBulkhead,
  getProviderBulkheadSnapshot,
  getProviderBulkheadSnapshots,
  isProviderBulkheadError,
  resetProviderBulkheads
} = require("../ai/provider-bulkhead");
const {
  getProviderCircuitSnapshot,
  recordProviderCircuitFailure,
  resetProviderCircuitBreakers
} = require("../ai/provider-circuit-breaker");
const {
  getProviderTelemetrySnapshot,
  resetProviderTelemetry
} = require("../ai/provider-telemetry");
const {
  aiDiagnosticSnapshot
} = require("../ops/system-diagnostics");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function main() {
  const tracked = [
    "AI_PROVIDER",
    "AI_FALLBACK_PROVIDER",
    "AI_PROVIDER_MAX_CONCURRENT",
    "AI_PROVIDER_MAX_QUEUE",
    "AI_PROVIDER_QUEUE_TIMEOUT_MS",
    "AI_PROVIDER_CIRCUIT_BREAKER_FAILURES",
    "AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS",
    "GEMINI_MAX_CONCURRENT",
    "OPENAI_MAX_CONCURRENT",
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_MODEL_FALLBACK"
  ];
  const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

  const originalGoogleGenerate = google.generateChat;
  const originalGoogleStream = google.streamChat;
  const originalAnthropicGenerate = anthropic.generateChat;
  const originalAnthropicStream = anthropic.streamChat;
  const originalOpenAiAnalyze = openai.analyzeFile;

  try {
    assert.deepStrictEqual(
      getProviderBulkheadPolicy("google", {}),
      {
        maxConcurrent: DEFAULT_PROVIDER_BULKHEAD_POLICY.maxConcurrent,
        maxQueue: DEFAULT_PROVIDER_BULKHEAD_POLICY.maxQueue,
        queueTimeoutMs: DEFAULT_PROVIDER_BULKHEAD_POLICY.queueTimeoutMs
      }
    );

    const bounded = getProviderBulkheadPolicy("google", {
      AI_PROVIDER_MAX_CONCURRENT: "9999",
      AI_PROVIDER_MAX_QUEUE: "-9",
      AI_PROVIDER_QUEUE_TIMEOUT_MS: "1"
    });
    assert.strictEqual(
      bounded.maxConcurrent,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.maxConcurrentLimit
    );
    assert.strictEqual(bounded.maxQueue, 0);
    assert.strictEqual(
      bounded.queueTimeoutMs,
      DEFAULT_PROVIDER_BULKHEAD_POLICY.minQueueTimeoutMs
    );

    const overridden = getProviderBulkheadPolicy("google", {
      AI_PROVIDER_MAX_CONCURRENT: "7",
      GEMINI_MAX_CONCURRENT: "3",
      AI_PROVIDER_MAX_QUEUE: "5",
      AI_PROVIDER_QUEUE_TIMEOUT_MS: "700"
    });
    assert.deepStrictEqual(overridden, {
      maxConcurrent: 3,
      maxQueue: 5,
      queueTimeoutMs: 700
    });

    resetProviderBulkheads();
    const queueEnv = {
      AI_PROVIDER_MAX_CONCURRENT: "1",
      AI_PROVIDER_MAX_QUEUE: "1",
      AI_PROVIDER_QUEUE_TIMEOUT_MS: "1000"
    };
    const first = await acquireProviderBulkheadSlot("google", { env: queueEnv });
    const secondPromise = acquireProviderBulkheadSlot("google", { env: queueEnv });
    await Promise.resolve();

    let snapshot = getProviderBulkheadSnapshot("google", queueEnv);
    assert.strictEqual(snapshot.active, 1);
    assert.strictEqual(snapshot.queued, 1);
    assert.strictEqual(snapshot.maxObservedActive, 1);
    assert.strictEqual(snapshot.maxObservedQueue, 1);

    first.release();
    const second = await secondPromise;
    snapshot = getProviderBulkheadSnapshot("google", queueEnv);
    assert.strictEqual(snapshot.active, 1);
    assert.strictEqual(snapshot.queued, 0);
    assert.strictEqual(snapshot.queuedTotal, 1);
    second.release();
    assert.strictEqual(getProviderBulkheadSnapshot("google", queueEnv).active, 0);

    resetProviderBulkheads();
    const rejectEnv = {
      AI_PROVIDER_MAX_CONCURRENT: "1",
      AI_PROVIDER_MAX_QUEUE: "0",
      AI_PROVIDER_QUEUE_TIMEOUT_MS: "100"
    };
    const occupied = await acquireProviderBulkheadSlot("google", { env: rejectEnv });
    let rejectedError = null;
    try {
      await acquireProviderBulkheadSlot("google", { env: rejectEnv });
    } catch (error) {
      rejectedError = error;
    }
    assert.ok(rejectedError);
    assert.strictEqual(rejectedError.code, "AI_PROVIDER_BULKHEAD_REJECTED");
    assert.strictEqual(rejectedError.statusCode, 503);
    assert.strictEqual(isProviderBulkheadError(rejectedError), true);
    assert.strictEqual(isRetryableProviderError(rejectedError), true);
    assert.strictEqual(
      getProviderBulkheadSnapshot("google", rejectEnv).rejected,
      1
    );

    const anthroPermit = await acquireProviderBulkheadSlot("anthropic", {
      env: rejectEnv
    });
    assert.strictEqual(
      getProviderBulkheadSnapshot("anthropic", rejectEnv).active,
      1
    );
    anthroPermit.release();
    occupied.release();

    resetProviderBulkheads();
    const timeoutEnv = {
      AI_PROVIDER_MAX_CONCURRENT: "1",
      AI_PROVIDER_MAX_QUEUE: "1",
      AI_PROVIDER_QUEUE_TIMEOUT_MS: "100"
    };
    const timeoutPermit = await acquireProviderBulkheadSlot("google", {
      env: timeoutEnv
    });
    const keepAlive = setTimeout(() => {}, 250);
    await assert.rejects(
      () => acquireProviderBulkheadSlot("google", { env: timeoutEnv }),
      (error) =>
        error &&
        error.code === "AI_PROVIDER_BULKHEAD_QUEUE_TIMEOUT" &&
        error.statusCode === 503
    );
    clearTimeout(keepAlive);
    snapshot = getProviderBulkheadSnapshot("google", timeoutEnv);
    assert.strictEqual(snapshot.active, 1);
    assert.strictEqual(snapshot.queued, 0);
    assert.strictEqual(snapshot.queueTimeouts, 1);
    timeoutPermit.release();

    resetProviderBulkheads();
    await assert.rejects(
      () => runWithProviderBulkhead(
        "google",
        async () => {
          throw new Error("operation failed");
        },
        { env: rejectEnv }
      ),
      /operation failed/
    );
    assert.strictEqual(getProviderBulkheadSnapshot("google", rejectEnv).active, 0);

    process.env.AI_PROVIDER = "google";
    process.env.AI_FALLBACK_PROVIDER = "anthropic";
    process.env.GEMINI_API_KEY = "gemini-test-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.ANTHROPIC_MODEL_FALLBACK = "claude-sonnet-5-fallback";
    process.env.AI_PROVIDER_MAX_CONCURRENT = "1";
    process.env.AI_PROVIDER_MAX_QUEUE = "0";
    process.env.AI_PROVIDER_QUEUE_TIMEOUT_MS = "100";
    process.env.AI_PROVIDER_CIRCUIT_BREAKER_FAILURES = "1";
    process.env.AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS = "10000";

    resetProviderBulkheads();
    resetProviderCircuitBreakers();
    resetProviderTelemetry();

    let googleCalls = 0;
    let anthropicCalls = 0;
    google.generateChat = async () => {
      googleCalls += 1;
      return {
        provider: "google",
        model: "gemini-3.8-flash",
        reply: "primary",
        usage: null,
        responseId: "primary",
        research: { sources: [], citations: [], webSearchCalls: 0 }
      };
    };
    anthropic.generateChat = async ({ model }) => {
      anthropicCalls += 1;
      return {
        provider: "anthropic",
        model,
        reply: "fallback",
        usage: null,
        responseId: "fallback",
        research: { sources: [], citations: [], webSearchCalls: 0 }
      };
    };

    const primaryPermit = await acquireProviderBulkheadSlot("google");
    const fallbackResult = await generateChat({
      instructions: "system",
      input: [{ role: "user", content: "saturated primary" }],
      model: "gemini-3.8-flash"
    });
    assert.strictEqual(fallbackResult.provider, "anthropic");
    assert.strictEqual(googleCalls, 0);
    assert.strictEqual(anthropicCalls, 1);

    const circuitAfterSaturation = getProviderCircuitSnapshot({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic"
    });
    assert.strictEqual(circuitAfterSaturation.state, "closed");
    assert.strictEqual(circuitAfterSaturation.failures, 0);

    const telemetry = getProviderTelemetrySnapshot();
    assert.strictEqual(telemetry.providers.google, undefined);
    assert.strictEqual(telemetry.providers.anthropic.attempts, 1);
    assert.strictEqual(telemetry.routing.failovers, 1);
    primaryPermit.release();

    resetProviderBulkheads();
    resetProviderCircuitBreakers();
    resetProviderTelemetry();
    anthropicCalls = 0;

    const halfOpenBlocker = await acquireProviderBulkheadSlot("google");
    const now = Date.now();
    recordProviderCircuitFailure({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      retryable: true,
      errorCode: "ETIMEDOUT",
      env: process.env,
      now: now - 20000
    });

    const halfOpenBefore = getProviderCircuitSnapshot({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      now
    });
    assert.strictEqual(halfOpenBefore.state, "half-open");
    assert.strictEqual(halfOpenBefore.halfOpenProbeInFlight, false);

    const halfOpenFallback = await generateChat({
      instructions: "system",
      input: [{ role: "user", content: "half-open under local saturation" }],
      model: "gemini-3.8-flash"
    });
    assert.strictEqual(halfOpenFallback.provider, "anthropic");
    assert.strictEqual(anthropicCalls, 1);

    const halfOpenAfter = getProviderCircuitSnapshot({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic"
    });
    assert.strictEqual(halfOpenAfter.state, "half-open");
    assert.strictEqual(halfOpenAfter.halfOpenProbeInFlight, false);
    assert.strictEqual(halfOpenAfter.failures, 1);
    halfOpenBlocker.release();

    resetProviderBulkheads();
    resetProviderCircuitBreakers();
    let googleStreamCalls = 0;
    let anthropicStreamCalls = 0;
    google.streamChat = async () => {
      googleStreamCalls += 1;
      throw new Error("primary stream should be bulkhead-bypassed");
    };
    anthropic.streamChat = async ({ onDelta, model }) => {
      anthropicStreamCalls += 1;
      if (onDelta) await onDelta("fallback stream");
      return {
        provider: "anthropic",
        model,
        reply: "fallback stream",
        usage: null,
        responseId: "fallback-stream",
        research: { sources: [], citations: [], webSearchCalls: 0 }
      };
    };

    const streamBlocker = await acquireProviderBulkheadSlot("google");
    const deltas = [];
    const streamed = await streamChat({
      instructions: "system",
      input: [{ role: "user", content: "stream saturation" }],
      model: "gemini-3.8-flash",
      onDelta: async (delta) => deltas.push(delta)
    });
    assert.strictEqual(streamed.provider, "anthropic");
    assert.strictEqual(googleStreamCalls, 0);
    assert.strictEqual(anthropicStreamCalls, 1);
    assert.deepStrictEqual(deltas, ["fallback stream"]);
    streamBlocker.release();

    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "openai-test-key";
    resetProviderBulkheads();
    let analyzeCalls = 0;
    openai.analyzeFile = async () => {
      analyzeCalls += 1;
      return { provider: "openai", model: "gpt-5.6-luna", reply: "file" };
    };
    const fileBlocker = await acquireProviderBulkheadSlot("openai");
    await assert.rejects(
      () => analyzeFile({
        filename: "note.txt",
        mimeType: "text/plain",
        fileBase64: "aGVsbG8=",
        prompt: "summarize"
      }),
      (error) => error && error.code === "AI_PROVIDER_BULKHEAD_REJECTED"
    );
    assert.strictEqual(analyzeCalls, 0);
    fileBlocker.release();

    process.env.AI_PROVIDER = "google";
    resetProviderBulkheads();
    const statusWithoutAdminMetrics = getGatewayStatus();
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(statusWithoutAdminMetrics, "bulkheads"),
      false
    );

    const diagnosticBlocker = await acquireProviderBulkheadSlot("google");
    const adminStatus = getGatewayStatus({ includeTelemetry: true });
    assert.ok(adminStatus.bulkheads.google);
    assert.strictEqual(adminStatus.bulkheads.google.active, 1);
    assert.strictEqual(adminStatus.bulkheads.google.maxConcurrent, 1);

    const diagnostic = aiDiagnosticSnapshot(adminStatus);
    assert.strictEqual(diagnostic.status, "yellow");
    assert.match(diagnostic.summary, /configured concurrency limit/i);
    diagnosticBlocker.release();

    const snapshots = getProviderBulkheadSnapshots(["google", "anthropic", "google"]);
    assert.deepStrictEqual(Object.keys(snapshots).sort(), ["anthropic", "google"]);

    const selfHealSource = fs.readFileSync(
      path.join(__dirname, "..", "ops", "self-heal.js"),
      "utf8"
    );
    assert.ok(selfHealSource.includes('"ai/provider-bulkhead.js"'));

    const diagnosticsIntegration = fs.readFileSync(
      path.join(__dirname, "..", "ops", "diagnostics-server-integration.js"),
      "utf8"
    );
    assert.ok(
      diagnosticsIntegration.includes(
        "aiStatus: getGatewayStatus({ includeTelemetry: true })"
      )
    );

    console.log(
      "PASS provider bulkheads: bounded per-provider policy, queue admission/release, queue rejection/timeout, provider isolation, permit cleanup, saturation failover without circuit poisoning, half-open probe cancellation, streaming/file enforcement, admin-only live metrics, diagnostics warning, and self-heal protection."
    );
  } finally {
    google.generateChat = originalGoogleGenerate;
    google.streamChat = originalGoogleStream;
    anthropic.generateChat = originalAnthropicGenerate;
    anthropic.streamChat = originalAnthropicStream;
    openai.analyzeFile = originalOpenAiAnalyze;

    resetProviderBulkheads();
    resetProviderCircuitBreakers();
    resetProviderTelemetry();

    for (const key of tracked) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
