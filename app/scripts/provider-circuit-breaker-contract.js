const assert = require("assert");
const fs = require("fs");
const path = require("path");
const google = require("../ai/providers/google");
const anthropic = require("../ai/providers/anthropic");
const {
  generateChat,
  getGatewayStatus
} = require("../ai/gateway");
const {
  DEFAULT_CIRCUIT_POLICY,
  getProviderCircuitPolicy,
  getProviderCircuitSnapshot,
  beginProviderCircuitAttempt,
  recordProviderCircuitSuccess,
  recordProviderCircuitFailure,
  resetProviderCircuitBreakers
} = require("../ai/provider-circuit-breaker");
const {
  aiDiagnosticSnapshot
} = require("../ops/system-diagnostics");

async function main() {
  const tracked = [
    "AI_PROVIDER",
    "AI_FALLBACK_PROVIDER",
    "AI_FALLBACK_MODEL",
    "AI_PROVIDER_CIRCUIT_BREAKER_ENABLED",
    "AI_PROVIDER_CIRCUIT_BREAKER_FAILURES",
    "AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_MODEL_FALLBACK"
  ];
  const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

  try {
    const unitEnv = {
      AI_FALLBACK_PROVIDER: "anthropic",
      AI_PROVIDER_CIRCUIT_BREAKER_FAILURES: "2",
      AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "10000"
    };

    assert.deepStrictEqual(
      getProviderCircuitPolicy(unitEnv),
      { enabled: true, failureThreshold: 2, cooldownMs: 10000 }
    );
    assert.strictEqual(
      getProviderCircuitPolicy({
        AI_FALLBACK_PROVIDER: "anthropic",
        AI_PROVIDER_CIRCUIT_BREAKER_FAILURES: "999",
        AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "1"
      }).failureThreshold,
      DEFAULT_CIRCUIT_POLICY.maxFailureThreshold
    );
    assert.strictEqual(
      getProviderCircuitPolicy({
        AI_FALLBACK_PROVIDER: "anthropic",
        AI_PROVIDER_CIRCUIT_BREAKER_FAILURES: "999",
        AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS: "1"
      }).cooldownMs,
      DEFAULT_CIRCUIT_POLICY.minCooldownMs
    );
    assert.strictEqual(
      getProviderCircuitPolicy({
        AI_FALLBACK_PROVIDER: "anthropic",
        AI_PROVIDER_CIRCUIT_BREAKER_ENABLED: "false"
      }).enabled,
      false
    );

    resetProviderCircuitBreakers();
    let attempt = beginProviderCircuitAttempt({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      env: unitEnv,
      now: 1000
    });
    assert.strictEqual(attempt.bypassPrimary, false);
    assert.strictEqual(attempt.snapshot.state, "closed");

    let snapshot = recordProviderCircuitFailure({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      retryable: true,
      errorCode: "GEMINI_REQUEST_FAILED",
      env: unitEnv,
      now: 1000
    });
    assert.strictEqual(snapshot.state, "closed");
    assert.strictEqual(snapshot.failures, 1);

    snapshot = recordProviderCircuitFailure({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      retryable: true,
      errorCode: "GEMINI_REQUEST_FAILED",
      env: unitEnv,
      now: 2000
    });
    assert.strictEqual(snapshot.state, "open");
    assert.strictEqual(snapshot.failures, 2);
    assert.strictEqual(snapshot.openUntil, new Date(12000).toISOString());
    assert.strictEqual(snapshot.lastErrorCode, "GEMINI_REQUEST_FAILED");

    attempt = beginProviderCircuitAttempt({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      env: unitEnv,
      now: 3000
    });
    assert.strictEqual(attempt.bypassPrimary, true);
    assert.strictEqual(attempt.snapshot.state, "open");

    attempt = beginProviderCircuitAttempt({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      env: unitEnv,
      now: 12000
    });
    assert.strictEqual(attempt.bypassPrimary, false);
    assert.strictEqual(attempt.halfOpenProbe, true);
    assert.strictEqual(attempt.snapshot.state, "half-open");

    const concurrent = beginProviderCircuitAttempt({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      env: unitEnv,
      now: 12001
    });
    assert.strictEqual(concurrent.bypassPrimary, true);
    assert.strictEqual(concurrent.snapshot.halfOpenProbeInFlight, true);

    snapshot = recordProviderCircuitSuccess({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      env: unitEnv,
      now: 13000
    });
    assert.strictEqual(snapshot.state, "closed");
    assert.strictEqual(snapshot.failures, 0);
    assert.strictEqual(snapshot.openUntil, null);

    recordProviderCircuitFailure({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      retryable: true,
      errorCode: "ETIMEDOUT",
      env: unitEnv,
      now: 14000
    });
    snapshot = recordProviderCircuitFailure({
      primaryProviderId: "google",
      fallbackProviderId: "anthropic",
      retryable: false,
      errorCode: "AUTH_ERROR",
      env: unitEnv,
      now: 15000
    });
    assert.strictEqual(snapshot.state, "closed");
    assert.strictEqual(snapshot.failures, 0);
    assert.strictEqual(snapshot.lastErrorCode, null);

    const openDiagnostic = aiDiagnosticSnapshot({
      configured: true,
      provider: "google",
      model: "gemini-3.8-flash",
      failoverEnabled: true,
      fallbackProvider: "anthropic",
      circuitBreaker: {
        enabled: true,
        state: "open"
      }
    });
    assert.strictEqual(openDiagnostic.status, "yellow");
    assert.match(openDiagnostic.summary, /temporarily bypassed/);
    assert.strictEqual(openDiagnostic.fallbackProvider, "anthropic");

    const healthyDiagnostic = aiDiagnosticSnapshot({
      configured: true,
      provider: "google",
      model: "gemini-3.8-flash",
      circuitBreaker: { enabled: true, state: "closed" }
    });
    assert.strictEqual(healthyDiagnostic.status, "green");

    const unconfiguredDiagnostic = aiDiagnosticSnapshot({
      configured: false,
      provider: "google"
    });
    assert.strictEqual(unconfiguredDiagnostic.status, "yellow");

    process.env.AI_PROVIDER = "google";
    process.env.GEMINI_API_KEY = "gemini-secret";
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    process.env.AI_FALLBACK_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "anthropic-secret";
    process.env.ANTHROPIC_MODEL_FALLBACK = "claude-sonnet-5-fallback";
    process.env.AI_PROVIDER_CIRCUIT_BREAKER_FAILURES = "1";
    process.env.AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS = "10000";

    resetProviderCircuitBreakers();
    const originalGoogleGenerate = google.generateChat;
    const originalAnthropicGenerate = anthropic.generateChat;
    let primaryCalls = 0;
    let fallbackCalls = 0;

    try {
      google.generateChat = async () => {
        primaryCalls += 1;
        const error = new Error("temporary primary outage");
        error.code = "GEMINI_REQUEST_FAILED";
        error.statusCode = 503;
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
        input: [{ role: "user", content: "hello" }],
        model: "gemini-3.8-flash"
      });
      assert.strictEqual(first.provider, "anthropic");
      assert.strictEqual(primaryCalls, 1);
      assert.strictEqual(fallbackCalls, 1);

      const status = getGatewayStatus();
      assert.strictEqual(status.circuitBreaker.state, "open");
      assert.strictEqual(status.circuitBreaker.failureThreshold, 1);

      google.generateChat = async () => {
        primaryCalls += 1;
        return {
          provider: "google",
          model: "gemini-3.8-flash",
          reply: "primary should have been bypassed",
          usage: null,
          responseId: "primary",
          research: { sources: [], citations: [], webSearchCalls: 0 }
        };
      };

      const second = await generateChat({
        instructions: "system",
        input: [{ role: "user", content: "hello again" }],
        model: "gemini-3.8-flash"
      });
      assert.strictEqual(second.provider, "anthropic");
      assert.strictEqual(primaryCalls, 1);
      assert.strictEqual(fallbackCalls, 2);
    } finally {
      google.generateChat = originalGoogleGenerate;
      anthropic.generateChat = originalAnthropicGenerate;
      resetProviderCircuitBreakers();
    }

    const selfHealSource = fs.readFileSync(
      path.join(__dirname, "..", "ops", "self-heal.js"),
      "utf8"
    );
    assert.ok(selfHealSource.includes('"ai/gateway.js"'));
    assert.ok(selfHealSource.includes('"ai/provider-circuit-breaker.js"'));

    console.log(
      "PASS provider circuit breaker: bounded policy, open/half-open/close lifecycle, direct fallback bypass, diagnostics visibility, non-transient reset, and self-heal protection."
    );
  } finally {
    resetProviderCircuitBreakers();
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
