const assert = require("assert");
const fs = require("fs");
const path = require("path");
const google = require("../ai/providers/google");
const anthropic = require("../ai/providers/anthropic");
const local = require("../ai/providers/local");
const {
  parseRetryAfterMs,
  retryAfterMsFromHeaders,
  providerError
} = require("../ai/providers/provider-utils");
const {
  normalizeRetryAfterMs,
  recordProviderCircuitFailure,
  recordProviderCircuitSuccess,
  beginProviderCircuitAttempt,
  getProviderCircuitSnapshot,
  resetProviderCircuitBreakers
} = require("../ai/provider-circuit-breaker");
const {
  generateChat,
  getGatewayStatus,
  providerRetryAfterMs
} = require("../ai/gateway");
const {
  resetProviderBulkheads
} = require("../ai/provider-bulkhead");
const {
  resetProviderTelemetry
} = require("../ai/provider-telemetry");

function responseHeaders(retryAfter) {
  return {
    get(name) {
      return String(name || "").toLowerCase() === "retry-after"
        ? retryAfter
        : null;
    }
  };
}

function failedResponse(status, retryAfter, message = "rate limited") {
  return {
    ok: false,
    status,
    headers: responseHeaders(retryAfter),
    json: async () => ({ error: { message } }),
    text: async () => message
  };
}

async function main() {
  const tracked = [
    "AI_PROVIDER",
    "AI_FALLBACK_PROVIDER",
    "AI_PROVIDER_CIRCUIT_BREAKER_FAILURES",
    "AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS",
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL_FALLBACK",
    "UNBOUND_LOCAL_AI_ENDPOINT",
    "UNBOUND_LOCAL_AI_MODEL"
  ];
  const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

  const originalGoogleGenerate = google.generateChat;
  const originalAnthropicGenerate = anthropic.generateChat;

  try {
    const baseNow = Date.parse("2026-09-18T22:00:00Z");
    assert.strictEqual(
      parseRetryAfterMs("12", { now: baseNow }),
      12000
    );
    assert.strictEqual(
      parseRetryAfterMs(
        "Fri, 18 Sep 2026 22:00:20 GMT",
        { now: baseNow }
      ),
      20000
    );
    assert.strictEqual(parseRetryAfterMs("0", { now: baseNow }), null);
    assert.strictEqual(parseRetryAfterMs("-1", { now: baseNow }), null);
    assert.strictEqual(parseRetryAfterMs("not-a-date", { now: baseNow }), null);
    assert.strictEqual(
      parseRetryAfterMs("9999", { now: baseNow, maxMs: 300000 }),
      300000
    );

    assert.strictEqual(
      retryAfterMsFromHeaders({ "Retry-After": "21" }),
      21000
    );
    assert.strictEqual(
      retryAfterMsFromHeaders(responseHeaders("18")),
      18000
    );

    const metadataError = providerError(
      "TEST_PROVIDER_ERROR",
      "test",
      429,
      { retryAfterMs: 25000 }
    );
    assert.strictEqual(metadataError.retryAfterMs, 25000);

    assert.strictEqual(normalizeRetryAfterMs(5000), 10000);
    assert.strictEqual(normalizeRetryAfterMs(45000), 45000);
    assert.strictEqual(normalizeRetryAfterMs(999999), 300000);
    assert.strictEqual(normalizeRetryAfterMs(0), null);

    const circuitEnv = {
      AI_FALLBACK_PROVIDER: "anthropic",
      AI_PROVIDER_CIRCUIT_BREAKER_FAILURES: "3",
      AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "60000"
    };

    resetProviderCircuitBreakers();
    let snapshot = recordProviderCircuitFailure({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      retryable: true,
      errorCode: "GEMINI_REQUEST_FAILED",
      retryAfterMs: 120000,
      env: circuitEnv,
      now: 1000
    });
    assert.strictEqual(snapshot.state, "open");
    assert.strictEqual(snapshot.failures, 1);
    assert.strictEqual(snapshot.openReason, "retry-after");
    assert.strictEqual(snapshot.lastRetryAfterMs, 120000);
    assert.strictEqual(snapshot.activeCooldownMs, 120000);
    assert.strictEqual(snapshot.openUntil, new Date(121000).toISOString());

    let attempt = beginProviderCircuitAttempt({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      env: circuitEnv,
      now: 2000
    });
    assert.strictEqual(attempt.bypassPrimary, true);
    assert.strictEqual(attempt.snapshot.state, "open");

    attempt = beginProviderCircuitAttempt({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      env: circuitEnv,
      now: 121001
    });
    assert.strictEqual(attempt.bypassPrimary, false);
    assert.strictEqual(attempt.halfOpenProbe, true);
    assert.strictEqual(attempt.snapshot.state, "half-open");

    snapshot = recordProviderCircuitSuccess({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      env: circuitEnv,
      now: 121002
    });
    assert.strictEqual(snapshot.state, "closed");
    assert.strictEqual(snapshot.openReason, null);
    assert.strictEqual(snapshot.lastRetryAfterMs, null);
    assert.strictEqual(snapshot.activeCooldownMs, 0);

    resetProviderCircuitBreakers();
    snapshot = recordProviderCircuitFailure({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      retryable: true,
      errorCode: "GEMINI_REQUEST_FAILED",
      retryAfterMs: 1000,
      env: circuitEnv,
      now: 5000
    });
    assert.strictEqual(snapshot.state, "open");
    assert.strictEqual(snapshot.activeCooldownMs, 10000);
    assert.strictEqual(snapshot.lastRetryAfterMs, 10000);

    resetProviderCircuitBreakers();
    snapshot = recordProviderCircuitFailure({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      retryable: true,
      errorCode: "ETIMEDOUT",
      env: circuitEnv,
      now: 1000
    });
    assert.strictEqual(snapshot.state, "closed");
    assert.strictEqual(snapshot.failures, 1);
    assert.strictEqual(snapshot.openReason, null);
    assert.strictEqual(snapshot.lastRetryAfterMs, null);

    assert.strictEqual(
      providerRetryAfterMs({
        headers: { "retry-after": "45" }
      }),
      45000
    );
    assert.strictEqual(
      providerRetryAfterMs({
        retryAfterMs: 31000,
        headers: { "retry-after": "99" }
      }),
      31000
    );

    process.env.GEMINI_API_KEY = "gemini-test-key";
    await assert.rejects(
      () => google.generateChat({
        instructions: "system",
        input: [{ role: "user", content: "rate limit" }],
        fetchImpl: async () => failedResponse(429, "30", "Gemini throttled")
      }),
      (error) =>
        error &&
        error.statusCode === 429 &&
        error.retryAfterMs === 30000
    );

    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    await assert.rejects(
      () => anthropic.generateChat({
        instructions: "system",
        input: [{ role: "user", content: "rate limit" }],
        fetchImpl: async () => failedResponse(429, "31", "Anthropic throttled")
      }),
      (error) =>
        error &&
        error.statusCode === 429 &&
        error.retryAfterMs === 31000
    );

    process.env.UNBOUND_LOCAL_AI_ENDPOINT = "http://127.0.0.1:11434";
    process.env.UNBOUND_LOCAL_AI_MODEL = "local-test";
    await assert.rejects(
      () => local.generateChat({
        instructions: "system",
        input: [{ role: "user", content: "rate limit" }],
        fetchImpl: async () => failedResponse(429, "32", "Local throttled")
      }),
      (error) =>
        error &&
        error.statusCode === 429 &&
        error.retryAfterMs === 32000
    );

    process.env.AI_PROVIDER = "google";
    process.env.AI_FALLBACK_PROVIDER = "anthropic";
    process.env.AI_PROVIDER_CIRCUIT_BREAKER_FAILURES = "3";
    process.env.AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS = "60000";
    process.env.ANTHROPIC_MODEL_FALLBACK = "claude-sonnet-5-fallback";

    resetProviderCircuitBreakers();
    resetProviderBulkheads();
    resetProviderTelemetry();

    let primaryCalls = 0;
    let fallbackCalls = 0;

    google.generateChat = async () => {
      primaryCalls += 1;
      const error = new Error("Gemini says slow down");
      error.code = "GEMINI_REQUEST_FAILED";
      error.statusCode = 429;
      error.retryAfterMs = 120000;
      throw error;
    };
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

    const first = await generateChat({
      instructions: "system",
      input: [{ role: "user", content: "first" }],
      model: "gemini-3.8-flash"
    });
    assert.strictEqual(first.provider, "anthropic");
    assert.strictEqual(primaryCalls, 1);
    assert.strictEqual(fallbackCalls, 1);

    const gateway = getGatewayStatus();
    assert.strictEqual(gateway.circuitBreaker.state, "open");
    assert.strictEqual(gateway.circuitBreaker.failures, 1);
    assert.strictEqual(gateway.circuitBreaker.openReason, "retry-after");
    assert.strictEqual(gateway.circuitBreaker.lastRetryAfterMs, 120000);

    const second = await generateChat({
      instructions: "system",
      input: [{ role: "user", content: "second" }],
      model: "gemini-3.8-flash"
    });
    assert.strictEqual(second.provider, "anthropic");
    assert.strictEqual(primaryCalls, 1);
    assert.strictEqual(fallbackCalls, 2);

    const selfHealSource = fs.readFileSync(
      path.join(__dirname, "..", "ops", "self-heal.js"),
      "utf8"
    );
    assert.ok(selfHealSource.includes('"ai/providers/provider-utils.js"'));

    console.log(
      "PASS provider Retry-After: bounded delta/date parsing, fetch-adapter propagation, OpenAI-style header extraction, immediate hinted circuit cooldown, normal no-hint threshold preservation, direct fallback bypass, and self-heal protection."
    );
  } finally {
    google.generateChat = originalGoogleGenerate;
    anthropic.generateChat = originalAnthropicGenerate;

    resetProviderCircuitBreakers();
    resetProviderBulkheads();
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
