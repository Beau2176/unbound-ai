const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const google = require("../ai/providers/google");
const anthropic = require("../ai/providers/anthropic");
const {
  generateChat,
  streamChat,
  isRetryableProviderError
} = require("../ai/gateway");
const {
  createProviderDeadline,
  providerCancellationError,
  isProviderCancellationError,
  runWithProviderDeadline
} = require("../ai/provider-deadline");
const {
  acquireProviderBulkheadSlot,
  getProviderBulkheadSnapshot,
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
  REQUEST_CANCELLATION_VERSION,
  createRequestCancellation,
  runWithRequestCancellation,
  shutdownAbortReason,
  abortAllRequestCancellations,
  getRequestCancellationSnapshot
} = require("../ops/request-cancellation");

function fakeRequest() {
  const req = new EventEmitter();
  req.aborted = false;
  return req;
}

function fakeResponse() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  return res;
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
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL_FALLBACK"
  ];
  const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

  const originalGoogleGenerate = google.generateChat;
  const originalGoogleStream = google.streamChat;
  const originalAnthropicGenerate = anthropic.generateChat;
  const originalAnthropicStream = anthropic.streamChat;

  try {
    {
      const req = fakeRequest();
      const res = fakeResponse();
      const cancellation = createRequestCancellation(req, res);
      assert.strictEqual(cancellation.signal.aborted, false);
      req.aborted = true;
      req.emit("aborted");
      assert.strictEqual(cancellation.signal.aborted, true);
      assert.strictEqual(req.listenerCount("aborted"), 0);
      assert.strictEqual(res.listenerCount("close"), 0);
      assert.strictEqual(res.listenerCount("finish"), 0);
    }

    {
      const req = fakeRequest();
      const res = fakeResponse();
      const cancellation = createRequestCancellation(req, res);
      res.writableEnded = true;
      res.emit("finish");
      assert.strictEqual(cancellation.signal.aborted, false);
      assert.strictEqual(req.listenerCount("aborted"), 0);
      assert.strictEqual(res.listenerCount("close"), 0);
    }

    {
      const req = fakeRequest();
      const res = fakeResponse();
      const cancellation = createRequestCancellation(req, res);
      res.destroyed = true;
      res.emit("close");
      assert.strictEqual(cancellation.signal.aborted, true);
    }

    {
      const req = fakeRequest();
      req.aborted = true;
      const res = fakeResponse();
      const cancellation = createRequestCancellation(req, res);
      assert.strictEqual(cancellation.signal.aborted, true);
    }

    {
      const req = fakeRequest();
      const res = fakeResponse();
      let receivedSignal = null;
      const result = await runWithRequestCancellation(
        req,
        res,
        async (signal) => {
          receivedSignal = signal;
          return "ok";
        }
      );
      assert.strictEqual(result, "ok");
      assert.ok(receivedSignal instanceof AbortSignal);
      assert.strictEqual(receivedSignal.aborted, false);
      assert.strictEqual(req.listenerCount("aborted"), 0);
      assert.strictEqual(res.listenerCount("close"), 0);
      assert.strictEqual(res.listenerCount("finish"), 0);
    }

    {
      assert.strictEqual(REQUEST_CANCELLATION_VERSION, "v1.1");
      const before = getRequestCancellationSnapshot();
      const reqA = fakeRequest();
      const resA = fakeResponse();
      const reqB = fakeRequest();
      const resB = fakeResponse();
      const first = createRequestCancellation(reqA, resA);
      const second = createRequestCancellation(reqB, resB);

      const active = getRequestCancellationSnapshot();
      assert.strictEqual(active.active, before.active + 2);

      const shutdownReason = shutdownAbortReason("SIGTERM");
      assert.strictEqual(shutdownReason.code, "SERVER_SHUTDOWN");
      assert.strictEqual(shutdownReason.signalName, "SIGTERM");

      const drained = abortAllRequestCancellations(shutdownReason);
      assert.strictEqual(drained.abortedCount, 2);
      assert.strictEqual(drained.activeAfterAbort, 0);
      assert.strictEqual(first.signal.aborted, true);
      assert.strictEqual(second.signal.aborted, true);
      assert.strictEqual(first.signal.reason?.code, "SERVER_SHUTDOWN");
      assert.strictEqual(second.signal.reason?.code, "SERVER_SHUTDOWN");

      const after = getRequestCancellationSnapshot();
      assert.strictEqual(after.active, 0);
      assert.strictEqual(after.shutdownAborts, before.shutdownAborts + 2);
      assert.strictEqual(after.lastAbortReason, "SERVER_SHUTDOWN");
    }

    {
      const external = new AbortController();
      const pending = runWithProviderDeadline(
        "chat",
        ({ signal }) => new Promise((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason || new Error("aborted")),
            { once: true }
          );
        }),
        {
          timeoutMs: 5000,
          externalSignal: external.signal,
          label: "Cancellation test"
        }
      );
      external.abort(new Error("client left"));
      await assert.rejects(
        () => pending,
        (error) =>
          error &&
          error.code === "AI_REQUEST_ABORTED" &&
          error.statusCode === 499 &&
          isProviderCancellationError(error)
      );
    }

    {
      const external = new AbortController();
      external.abort();
      const deadline = createProviderDeadline("chat", {
        timeoutMs: 5000,
        externalSignal: external.signal
      });
      assert.strictEqual(deadline.signal.aborted, true);
      assert.strictEqual(deadline.externallyAborted(), true);
      assert.strictEqual(deadline.timedOut(), false);
      deadline.cancel();
    }

    const cancellationError = providerCancellationError("Gateway test");
    assert.strictEqual(cancellationError.statusCode, 499);
    assert.strictEqual(isRetryableProviderError(cancellationError), false);

    resetProviderBulkheads();
    {
      const env = {
        AI_PROVIDER_MAX_CONCURRENT: "1",
        AI_PROVIDER_MAX_QUEUE: "1",
        AI_PROVIDER_QUEUE_TIMEOUT_MS: "1000"
      };
      const occupied = await acquireProviderBulkheadSlot("google", { env });
      const external = new AbortController();
      const queued = acquireProviderBulkheadSlot("google", {
        env,
        signal: external.signal
      });
      await Promise.resolve();
      assert.strictEqual(getProviderBulkheadSnapshot("google", env).queued, 1);
      external.abort(shutdownAbortReason("SIGTERM"));

      await assert.rejects(
        () => queued,
        (error) =>
          error &&
          error.code === "AI_REQUEST_ABORTED" &&
          error.cause?.code === "SERVER_SHUTDOWN"
      );

      const snapshot = getProviderBulkheadSnapshot("google", env);
      assert.strictEqual(snapshot.queued, 0);
      assert.strictEqual(snapshot.queueCancellations, 1);
      assert.strictEqual(snapshot.queueTimeouts, 0);
      occupied.release();
    }

    process.env.AI_PROVIDER = "google";
    process.env.AI_FALLBACK_PROVIDER = "anthropic";
    process.env.GEMINI_API_KEY = "gemini-test-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.ANTHROPIC_MODEL_FALLBACK = "claude-sonnet-5-fallback";
    process.env.AI_PROVIDER_MAX_CONCURRENT = "4";
    process.env.AI_PROVIDER_MAX_QUEUE = "4";
    process.env.AI_PROVIDER_QUEUE_TIMEOUT_MS = "1000";
    process.env.AI_PROVIDER_CIRCUIT_BREAKER_FAILURES = "1";
    process.env.AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS = "10000";

    resetProviderBulkheads();
    resetProviderCircuitBreakers();
    resetProviderTelemetry();

    let fallbackCalls = 0;
    google.generateChat = async ({ signal }) => new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(providerCancellationError("Mock Gemini request", signal.reason));
        return;
      }
      signal?.addEventListener?.(
        "abort",
        () => reject(providerCancellationError("Mock Gemini request", signal.reason)),
        { once: true }
      );
    });
    anthropic.generateChat = async ({ model }) => {
      fallbackCalls += 1;
      return {
        provider: "anthropic",
        model,
        reply: "fallback",
        usage: null,
        responseId: "fallback",
        research: { sources: [], citations: [], webSearchCalls: 0 }
      };
    };

    const activeAbort = new AbortController();
    const activeRequest = generateChat({
      instructions: "system",
      input: [{ role: "user", content: "cancel active request" }],
      model: "gemini-3.8-flash",
      signal: activeAbort.signal
    });
    await Promise.resolve();
    activeAbort.abort(new Error("client disconnected"));

    await assert.rejects(
      () => activeRequest,
      (error) => error && error.code === "AI_REQUEST_ABORTED"
    );
    assert.strictEqual(fallbackCalls, 0);

    let telemetry = getProviderTelemetrySnapshot();
    assert.strictEqual(telemetry.providers.google.attempts, 1);
    assert.strictEqual(telemetry.providers.google.cancellations, 1);
    assert.strictEqual(telemetry.providers.google.failures, 0);
    assert.strictEqual(telemetry.routing.failovers, 0);
    assert.strictEqual(
      getProviderBulkheadSnapshot("google").active,
      0
    );

    let circuit = getProviderCircuitSnapshot({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic"
    });
    assert.strictEqual(circuit.state, "closed");
    assert.strictEqual(circuit.failures, 0);

    resetProviderBulkheads();
    resetProviderCircuitBreakers();
    resetProviderTelemetry();
    fallbackCalls = 0;

    const now = Date.now();
    recordProviderCircuitFailure({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      retryable: true,
      errorCode: "ETIMEDOUT",
      env: process.env,
      now: now - 20000
    });
    circuit = getProviderCircuitSnapshot({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      now
    });
    assert.strictEqual(circuit.state, "half-open");

    const halfOpenAbort = new AbortController();
    const halfOpenRequest = generateChat({
      instructions: "system",
      input: [{ role: "user", content: "cancel half-open probe" }],
      model: "gemini-3.8-flash",
      signal: halfOpenAbort.signal
    });
    await Promise.resolve();
    halfOpenAbort.abort();

    await assert.rejects(
      () => halfOpenRequest,
      (error) => error && error.code === "AI_REQUEST_ABORTED"
    );
    assert.strictEqual(fallbackCalls, 0);

    circuit = getProviderCircuitSnapshot({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic"
    });
    assert.strictEqual(circuit.state, "half-open");
    assert.strictEqual(circuit.halfOpenProbeInFlight, false);
    assert.strictEqual(circuit.failures, 1);

    resetProviderBulkheads();
    resetProviderCircuitBreakers();
    resetProviderTelemetry();
    process.env.AI_PROVIDER_MAX_CONCURRENT = "1";
    process.env.AI_PROVIDER_MAX_QUEUE = "4";

    let primaryCalls = 0;
    google.generateChat = async () => {
      primaryCalls += 1;
      return {
        provider: "google",
        model: "gemini-3.8-flash",
        reply: "should not run",
        usage: null,
        responseId: "unexpected",
        research: { sources: [], citations: [], webSearchCalls: 0 }
      };
    };
    fallbackCalls = 0;

    const queueBlocker = await acquireProviderBulkheadSlot("google");
    const queuedAbort = new AbortController();
    const queuedRequest = generateChat({
      instructions: "system",
      input: [{ role: "user", content: "cancel queued request" }],
      model: "gemini-3.8-flash",
      signal: queuedAbort.signal
    });
    await Promise.resolve();
    assert.strictEqual(getProviderBulkheadSnapshot("google").queued, 1);
    queuedAbort.abort();

    await assert.rejects(
      () => queuedRequest,
      (error) => error && error.code === "AI_REQUEST_ABORTED"
    );
    assert.strictEqual(primaryCalls, 0);
    assert.strictEqual(fallbackCalls, 0);
    telemetry = getProviderTelemetrySnapshot();
    assert.strictEqual(telemetry.providers.google, undefined);
    assert.strictEqual(getProviderBulkheadSnapshot("google").queued, 0);
    assert.strictEqual(
      getProviderBulkheadSnapshot("google").queueCancellations,
      1
    );
    queueBlocker.release();

    resetProviderBulkheads();
    resetProviderCircuitBreakers();
    resetProviderTelemetry();
    process.env.AI_PROVIDER_MAX_CONCURRENT = "4";

    let fallbackStreamCalls = 0;
    google.streamChat = async ({ signal }) => new Promise((resolve, reject) => {
      signal?.addEventListener?.(
        "abort",
        () => reject(providerCancellationError("Mock Gemini stream", signal.reason)),
        { once: true }
      );
    });
    anthropic.streamChat = async () => {
      fallbackStreamCalls += 1;
      return {
        provider: "anthropic",
        model: "claude-sonnet-5-fallback",
        reply: "fallback stream",
        usage: null,
        responseId: "fallback-stream",
        research: { sources: [], citations: [], webSearchCalls: 0 }
      };
    };

    const streamAbort = new AbortController();
    const streamRequest = streamChat({
      instructions: "system",
      input: [{ role: "user", content: "cancel stream" }],
      model: "gemini-3.8-flash",
      onDelta: async () => {},
      signal: streamAbort.signal
    });
    await Promise.resolve();
    streamAbort.abort();

    await assert.rejects(
      () => streamRequest,
      (error) => error && error.code === "AI_REQUEST_ABORTED"
    );
    assert.strictEqual(fallbackStreamCalls, 0);
    telemetry = getProviderTelemetrySnapshot();
    assert.strictEqual(telemetry.providers.google.cancellations, 1);
    assert.strictEqual(telemetry.providers.google.failures, 0);

    // Verify a real fetch-based adapter receives the combined signal and
    // translates external aborts to the stable cancellation error.
    resetProviderBulkheads();
    const adapterAbort = new AbortController();
    let adapterSignal = null;
    let markAdapterStarted;
    const adapterStarted = new Promise((resolve) => {
      markAdapterStarted = resolve;
    });
    const adapterRequest = google.generateChat({
      instructions: "system",
      input: [{ role: "user", content: "adapter cancellation" }],
      signal: adapterAbort.signal,
      fetchImpl: async (url, options) => {
        adapterSignal = options.signal;
        markAdapterStarted();
        return new Promise((resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(options.signal.reason || new Error("aborted")),
            { once: true }
          );
        });
      }
    });
    await adapterStarted;
    assert.ok(adapterSignal instanceof AbortSignal);
    adapterAbort.abort();
    await assert.rejects(
      () => adapterRequest,
      (error) => error && error.code === "AI_REQUEST_ABORTED"
    );
    assert.strictEqual(adapterSignal.aborted, true);

    const serverSource = fs.readFileSync(
      path.join(__dirname, "..", "server.js"),
      "utf8"
    );
    assert.ok(serverSource.includes("runWithRequestCancellation,"));
    assert.ok(serverSource.includes("abortAllRequestCancellations,"));
    assert.ok(serverSource.includes("shutdownAbortReason"));
    assert.strictEqual(
      (serverSource.match(/await runWithRequestCancellation\(/g) || []).length,
      2
    );
    assert.ok(serverSource.includes("function handleCancelledAiResponse"));
    assert.ok(serverSource.includes('error?.cause?.code !== "SERVER_SHUTDOWN"'));
    assert.ok(serverSource.includes('res.setHeader("Retry-After", "5")'));

    const abortAllIndex = serverSource.indexOf(
      "abortAllRequestCancellations(shutdownAbortReason(signal))"
    );
    const serverCloseIndex = serverSource.indexOf("server.close(async");
    assert.ok(
      abortAllIndex >= 0 && serverCloseIndex > abortAllIndex,
      "Active AI requests must be cancelled before HTTP shutdown waits for open responses."
    );

    const selfHealSource = fs.readFileSync(
      path.join(__dirname, "..", "ops", "self-heal.js"),
      "utf8"
    );
    assert.ok(selfHealSource.includes('"ops/request-cancellation.js"'));

    console.log(
      "PASS request cancellation: HTTP lifecycle abort/cleanup, external deadline cancellation, active-request registry, graceful shutdown broadcast, queued shutdown-cause propagation, active and half-open gateway cancellation without fallback/circuit poisoning, separate cancellation telemetry, streaming cancellation, provider signal propagation, shutdown-before-server-close ordering, and self-heal protection."
    );
  } finally {
    google.generateChat = originalGoogleGenerate;
    google.streamChat = originalGoogleStream;
    anthropic.generateChat = originalAnthropicGenerate;
    anthropic.streamChat = originalAnthropicStream;

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
