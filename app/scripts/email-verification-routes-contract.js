const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  createEmailVerificationHandlers,
  createEmailVerificationRouter,
  sendEmailVerificationPage,
  errorResponse
} = require("../email/routes");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    file: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    sendFile(file) {
      this.file = file;
      return this;
    }
  };
}

async function main() {
  const calls = { status: [], send: [], resend: [], consume: [] };
  const verificationService = {
    async getStatus(payload) {
      calls.status.push(payload);
      return {
        state: "pending",
        verified: false,
        verificationRequired: true,
        canSend: true,
        canResend: true,
        expiresAt: null
      };
    },
    async send(payload) {
      calls.send.push(payload);
      return { sent: true, state: "pending", expiresAt: "2026-09-12T20:00:00.000Z" };
    },
    async resend(payload) {
      calls.resend.push(payload);
      return { sent: true, state: "pending", expiresAt: "2026-09-12T20:00:00.000Z" };
    },
    async consume(payload) {
      calls.consume.push(payload);
      return { verified: true, reason: "verified", userId: 12 };
    }
  };

  const pool = { id: "pool" };
  const user = { id: 12, email: "person@example.com" };
  const handlers = createEmailVerificationHandlers({
    getPool: () => pool,
    findSessionUser: async () => user,
    verificationService,
    env: { PUBLIC_APP_ORIGIN: "https://unbound.example" }
  });

  let res = createResponse();
  await handlers.status({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.verification.state, "pending");
  assert.strictEqual(calls.status[0].pool, pool);
  assert.strictEqual(calls.status[0].userId, 12);
  assert.ok(!("token" in res.body.verification));

  res = createResponse();
  await handlers.send({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body.verification, {
    sent: true,
    state: "pending",
    expiresAt: "2026-09-12T20:00:00.000Z"
  });

  res = createResponse();
  await handlers.resend({}, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.resend.length, 1);

  res = createResponse();
  await handlers.consume({ body: { token: "raw-browser-token" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { verification: { verified: true } });
  assert.strictEqual(calls.consume[0].token, "raw-browser-token");
  assert.ok(!("userId" in res.body.verification), "consume response must not expose internal account IDs");

  const signedOutHandlers = createEmailVerificationHandlers({
    getPool: () => pool,
    findSessionUser: async () => null,
    verificationService
  });
  res = createResponse();
  await signedOutHandlers.send({}, res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "Sign in to manage account email verification." });

  const noDatabaseHandlers = createEmailVerificationHandlers({
    getPool: () => null,
    findSessionUser: async () => user,
    verificationService
  });
  res = createResponse();
  await noDatabaseHandlers.status({}, res);
  assert.strictEqual(res.statusCode, 503);

  res = createResponse();
  await handlers.consume({ body: { token: "" } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "Verification link is invalid or expired." });

  const invalidConsumeHandlers = createEmailVerificationHandlers({
    getPool: () => pool,
    findSessionUser: async () => user,
    verificationService: {
      ...verificationService,
      async consume() {
        return { verified: false, reason: "already-used", userId: 12 };
      }
    }
  });
  res = createResponse();
  await invalidConsumeHandlers.consume({ body: { token: "some-token" } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "Verification link is invalid or expired." });
  assert.ok(!JSON.stringify(res.body).includes("already-used"), "public errors must not reveal token state");

  assert.deepStrictEqual(errorResponse({ code: "EMAIL_PROVIDER_NOT_CONFIGURED" }), {
    status: 503,
    message: "Email verification is temporarily unavailable."
  });
  assert.deepStrictEqual(errorResponse({ code: "EMAIL_VERIFICATION_DELIVERY_FAILED" }), {
    status: 502,
    message: "Verification email could not be sent."
  });

  const router = createEmailVerificationRouter({
    getPool: () => pool,
    findSessionUser: async () => user,
    verificationService
  });
  const routePaths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`)
    .sort();
  assert.deepStrictEqual(routePaths, [
    "GET /status",
    "POST /consume",
    "POST /resend",
    "POST /send"
  ]);

  res = createResponse();
  sendEmailVerificationPage({}, res);
  assert.strictEqual(res.headers["cache-control"], "no-store");
  assert.strictEqual(res.headers["referrer-policy"], "no-referrer");
  assert.ok(res.file.endsWith(`${path.sep}verify-email.html`));

  const page = fs.readFileSync(path.join(__dirname, "..", "verify-email.html"), "utf8");
  assert.match(page, /window\.location\.hash/);
  assert.doesNotMatch(page, /window\.location\.search/);
  assert.match(page, /history\.replaceState\(null, "", window\.location\.pathname\)/);
  assert.match(page, /fetch\("\/api\/email-verification\/consume"/);
  assert.doesNotMatch(page, /console\.log/);
  assert.doesNotMatch(page, /token=/i, "landing-page source must not contain a hard-coded token value");

  console.log("Email verification routes contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
