const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  attemptRegistrationEmailVerification,
  normalizeSafeState
} = require("../email/registration");

async function main() {
  assert.strictEqual(normalizeSafeState("PENDING"), "pending");
  assert.strictEqual(normalizeSafeState("verified"), "verified");
  assert.strictEqual(normalizeSafeState("provider-secret-state"), "unknown");

  let sendCalls = 0;
  const notReady = await attemptRegistrationEmailVerification({
    pool: { id: "pool" },
    user: { id: 7, email: "user@example.com" },
    env: { EMAIL_PROVIDER: "aws-ses" },
    readinessBuilder: () => ({ launchReady: false }),
    service: {
      send: async () => {
        sendCalls += 1;
        return { sent: true, state: "pending" };
      }
    }
  });
  assert.deepStrictEqual(notReady, {
    attempted: false,
    sent: false,
    state: "not-ready"
  });
  assert.strictEqual(sendCalls, 0, "registration send must not run before full readiness is green");

  const pool = { id: "pool" };
  const user = { id: 8, email: "ready@example.com", display_name: "Ready User" };
  const env = { EMAIL_PROVIDER: "aws-ses", TEST_MARKER: "registration" };
  let sendOptions = null;
  const sent = await attemptRegistrationEmailVerification({
    pool,
    user,
    env,
    readinessBuilder: ({ env: seenEnv }) => {
      assert.strictEqual(seenEnv, env);
      return { launchReady: true };
    },
    service: {
      send: async (options) => {
        sendOptions = options;
        return { sent: true, state: "pending", verificationUrl: "https://should-not-leak.invalid" };
      }
    }
  });
  assert.deepStrictEqual(sent, {
    attempted: true,
    sent: true,
    state: "pending"
  });
  assert.strictEqual(sendOptions.pool, pool);
  assert.strictEqual(sendOptions.user, user);
  assert.strictEqual(sendOptions.env, env);
  assert.ok(!JSON.stringify(sent).includes("verificationUrl"));
  assert.ok(!JSON.stringify(sent).includes("ready@example.com"));

  const alreadyVerified = await attemptRegistrationEmailVerification({
    pool,
    user,
    env,
    readinessBuilder: () => ({ launchReady: true }),
    service: { send: async () => ({ sent: false, state: "verified" }) }
  });
  assert.deepStrictEqual(alreadyVerified, {
    attempted: true,
    sent: false,
    state: "verified"
  });

  const providerFailure = await attemptRegistrationEmailVerification({
    pool,
    user,
    env,
    readinessBuilder: () => ({ launchReady: true }),
    service: {
      send: async () => {
        throw new Error("AWS_SECRET_ACCESS_KEY=do-not-leak provider-message-id=secret-id");
      }
    }
  });
  assert.deepStrictEqual(providerFailure, {
    attempted: true,
    sent: false,
    state: "failed"
  });
  const failureJson = JSON.stringify(providerFailure);
  assert.ok(!failureJson.includes("AWS_SECRET_ACCESS_KEY"));
  assert.ok(!failureJson.includes("provider-message-id"));
  assert.ok(!failureJson.includes("secret-id"));

  let readinessFailureSendCalls = 0;
  const readinessFailure = await attemptRegistrationEmailVerification({
    pool,
    user,
    env,
    readinessBuilder: () => {
      throw new Error("internal readiness detail");
    },
    service: {
      send: async () => {
        readinessFailureSendCalls += 1;
        return { sent: true, state: "pending" };
      }
    }
  });
  assert.deepStrictEqual(readinessFailure, {
    attempted: false,
    sent: false,
    state: "failed"
  });
  assert.strictEqual(readinessFailureSendCalls, 0);

  const source = fs.readFileSync(path.join(__dirname, "..", "email", "registration.js"), "utf8");
  assert.match(source, /readiness\?\.launchReady === true/);
  assert.doesNotMatch(source, /console\.(log|error|warn)/);
  assert.doesNotMatch(source, /verificationUrl/);
  assert.doesNotMatch(source, /tokenHash/);

  console.log("Email registration verification contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
