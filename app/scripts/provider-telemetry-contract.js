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
  resetProviderCircuitBreakers
} = require("../ai/provider-circuit-breaker");
const {
  TELEMETRY_VERSION,
  beginProviderAttempt,
  finishProviderAttempt,
  recordProviderRoutingEvent,
  getProviderTelemetrySnapshot,
  resetProviderTelemetry
} = require("../ai/provider-telemetry");
const {
  aiDiagnosticSnapshot
} = require("../ops/system-diagnostics");

async function main() {
  resetProviderTelemetry();

  const first = beginProviderAttempt({ providerId: "google", role: "primary" });
  finishProviderAttempt(first, {
    ok: true,
    durationMs: 500,
    now: 1000
  });

  const second = beginProviderAttempt({ providerId: "google", role: "primary" });
  finishProviderAttempt(second, {
    ok: false,
    retryable: true,
    errorCode: "GEMINI_REQUEST_FAILED",
    durationMs: 1500,
    now: 2000
  });

  const fallback = beginProviderAttempt({ providerId: "anthropic", role: "fallback" });
  finishProviderAttempt(fallback, {
    ok: true,
    durationMs: 4000,
    now: 3000
  });

  const research = beginProviderAttempt({ providerId: "openai", role: "research" });
  finishProviderAttempt(research, {
    ok: true,
    durationMs: 12000,
    now: 4000
  });

  assert.strictEqual(
    recordProviderRoutingEvent({
      type: "failover",
      fromProvider: "google",
      toProvider: "anthropic"
    }),
    true
  );
  assert.strictEqual(
    recordProviderRoutingEvent({
      type: "circuit_bypass",
      fromProvider: "google",
      toProvider: "anthropic"
    }),
    true
  );
  assert.strictEqual(
    recordProviderRoutingEvent({
      type: "made_up",
      fromProvider: "google",
      toProvider: "anthropic"
    }),
    false
  );

  let snapshot = getProviderTelemetrySnapshot();
  assert.strictEqual(snapshot.version, TELEMETRY_VERSION);
  assert.strictEqual(snapshot.scope, "current_process");
  assert.strictEqual(snapshot.privacy, "aggregate_content_blind");

  assert.strictEqual(snapshot.providers.google.attempts, 2);
  assert.strictEqual(snapshot.providers.google.successes, 1);
  assert.strictEqual(snapshot.providers.google.failures, 1);
  assert.strictEqual(snapshot.providers.google.retryableFailures, 1);
  assert.strictEqual(snapshot.providers.google.roles.primary, 2);
  assert.strictEqual(snapshot.providers.google.averageDurationMs, 1000);
  assert.strictEqual(snapshot.providers.google.maxDurationMs, 1500);
  assert.strictEqual(snapshot.providers.google.latencyBuckets.lt_1s, 1);
  assert.strictEqual(snapshot.providers.google.latencyBuckets["1s_3s"], 1);
  assert.strictEqual(snapshot.providers.google.lastErrorCode, "GEMINI_REQUEST_FAILED");

  assert.strictEqual(snapshot.providers.anthropic.roles.fallback, 1);
  assert.strictEqual(snapshot.providers.anthropic.latencyBuckets["3s_10s"], 1);
  assert.strictEqual(snapshot.providers.openai.roles.research, 1);
  assert.strictEqual(snapshot.providers.openai.latencyBuckets.gte_10s, 1);

  assert.strictEqual(snapshot.routing.failovers, 1);
  assert.strictEqual(snapshot.routing.circuitBypasses, 1);
  assert.deepStrictEqual(snapshot.routing.routes["google->anthropic"], {
    failovers: 1,
    circuitBypasses: 1
  });

  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    "prompt",
    "responseText",
    "credential",
    "rawError",
    "userId",
    "messageContent"
  ]) {
    assert.strictEqual(serialized.includes(forbidden), false);
  }

  const diagnostic = aiDiagnosticSnapshot({
    configured: true,
    provider: "google",
    model: "gemini-3.8-flash",
    telemetry: snapshot
  });
  assert.strictEqual(diagnostic.status, "green");
  assert.strictEqual(diagnostic.telemetry.privacy, "aggregate_content_blind");

  const tracked = [
    "AI_PROVIDER",
    "AI_FALLBACK_PROVIDER",
    "AI_PROVIDER_CIRCUIT_BREAKER_FAILURES",
    "AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL_FALLBACK"
  ];
  const original = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

  try {
    process.env.AI_PROVIDER = "google";
    process.env.GEMINI_API_KEY = "gemini-secret";
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    process.env.AI_FALLBACK_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "anthropic-secret";
    process.env.ANTHROPIC_MODEL_FALLBACK = "claude-sonnet-5-fallback";
    process.env.AI_PROVIDER_CIRCUIT_BREAKER_FAILURES = "1";
    process.env.AI_PROVIDER_CIRCUIT_BREAKER_COOLDOWN_MS = "10000";

    resetProviderTelemetry();
    resetProviderCircuitBreakers();

    const originalGoogleGenerate = google.generateChat;
    const originalAnthropicGenerate = anthropic.generateChat;
    let primaryCalls = 0;
    let fallbackCalls = 0;

    try {
      google.generateChat = async () => {
        primaryCalls += 1;
        const error = new Error("temporary outage");
        error.code = "GEMINI_REQUEST_FAILED";
        error.statusCode = 503;
        throw error;
      };
      anthropic.generateChat = async ({ model }) => {
        fallbackCalls += 1;
        return {
          provider: "anthropic",
          model,
          reply: "fallback answer",
          usage: null,
          responseId: "fallback",
          research: { sources: [], citations: [], webSearchCalls: 0 }
        };
      };

      const firstResponse = await generateChat({
        instructions: "system",
        input: [{ role: "user", content: "hello" }],
        model: "gemini-3.8-flash"
      });
      assert.strictEqual(firstResponse.provider, "anthropic");
      assert.strictEqual(primaryCalls, 1);
      assert.strictEqual(fallbackCalls, 1);

      const secondResponse = await generateChat({
        instructions: "system",
        input: [{ role: "user", content: "hello again" }],
        model: "gemini-3.8-flash"
      });
      assert.strictEqual(secondResponse.provider, "anthropic");
      assert.strictEqual(primaryCalls, 1);
      assert.strictEqual(fallbackCalls, 2);

      snapshot = getProviderTelemetrySnapshot();
      assert.strictEqual(snapshot.providers.google.attempts, 1);
      assert.strictEqual(snapshot.providers.google.failures, 1);
      assert.strictEqual(snapshot.providers.google.retryableFailures, 1);
      assert.strictEqual(snapshot.providers.anthropic.attempts, 2);
      assert.strictEqual(snapshot.providers.anthropic.successes, 2);
      assert.strictEqual(snapshot.providers.anthropic.roles.fallback, 2);
      assert.strictEqual(snapshot.routing.failovers, 1);
      assert.strictEqual(snapshot.routing.circuitBypasses, 1);

      const status = getGatewayStatus();
      assert.strictEqual(status.telemetry.routing.failovers, 1);
      assert.strictEqual(status.telemetry.routing.circuitBypasses, 1);
      assert.strictEqual(status.telemetry.privacy, "aggregate_content_blind");
    } finally {
      google.generateChat = originalGoogleGenerate;
      anthropic.generateChat = originalAnthropicGenerate;
    }
  } finally {
    resetProviderTelemetry();
    resetProviderCircuitBreakers();
    for (const key of tracked) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }

  const selfHealSource = fs.readFileSync(
    path.join(__dirname, "..", "ops", "self-heal.js"),
    "utf8"
  );
  assert.ok(selfHealSource.includes('"ai/provider-telemetry.js"'));

  console.log(
    "PASS provider telemetry: content-blind aggregate attempts, outcomes, latency buckets, failover/circuit routing events, gateway visibility, and self-heal protection."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
