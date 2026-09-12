const fs = require("fs");
const path = require("path");

const serverPath = path.resolve(__dirname, "..", "server.js");
let server = fs.readFileSync(serverPath, "utf8");

function replaceOnce(source, needle, replacement, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  }
  return source.replace(needle, replacement);
}

const oldAgeImport = `const {
  normalizeAgeVerificationStatus,
  ageVerificationAllowsAdultAccess,
  getAgeVerificationGatewayStatus,
  startAgeVerificationSession
} = require("./age/gateway");`;
const newAgeImport = `const {
  normalizeAgeVerificationStatus,
  ageVerificationAllowsAdultAccess,
  getAgeVerificationGatewayStatus,
  startAgeVerificationSession,
  processAgeVerificationWebhook,
  resolveAgeVerificationTransition
} = require("./age/gateway");`;
server = replaceOnce(server, oldAgeImport, newAgeImport, "age gateway webhook imports");

const webhookConstantAnchor = `const PASSKEY_FLOW_COOKIE = "unbound_passkey_flow";`;
server = replaceOnce(
  server,
  webhookConstantAnchor,
  `${webhookConstantAnchor}\nconst AGE_VERIFICATION_WEBHOOK_PATH = "/api/webhooks/age-verification";`,
  "webhook path constant"
);

const oldGuard = `app.use(
  createSameOriginApiGuard({
    isProduction: IS_PRODUCTION,
    publicOrigin: process.env.PUBLIC_APP_ORIGIN || ""
  })
);
app.use(express.json({ limit: "100kb" }));`;
const newGuard = `app.use(
  createSameOriginApiGuard({
    isProduction: IS_PRODUCTION,
    publicOrigin: process.env.PUBLIC_APP_ORIGIN || "",
    exemptPaths: [AGE_VERIFICATION_WEBHOOK_PATH]
  })
);
app.use(
  AGE_VERIFICATION_WEBHOOK_PATH,
  express.raw({ type: "*/*", limit: "100kb" })
);
app.use(express.json({ limit: "100kb" }));`;
server = replaceOnce(server, oldGuard, newGuard, "same-origin exemption and raw body parser");

const adminAnchor = `/* ----------------------------- ADMIN API ----------------------------- */`;
const webhookRoute = `app.post(
  AGE_VERIFICATION_WEBHOOK_PATH,
  requireDatabase,
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");
    let event;

    try {
      event = await processAgeVerificationWebhook({
        rawBody,
        headers: req.headers,
        requestId: req.requestId || null
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("AGE_VERIFICATION_")) {
        return res.status(Number(error.statusCode) || 400).json({
          error: error.publicMessage || "Age-verification webhook rejected.",
          code: error.code
        });
      }
      console.error("UNBOUND AI AGE VERIFICATION WEBHOOK VERIFY ERROR:", error);
      return res.status(500).json({ error: "Could not process age-verification webhook." });
    }

    const providerReferenceHash = hashAgeVerificationReference(event.providerReference);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const eventInsert = await client.query(
        \`INSERT INTO age_verification_events (
           provider,
           provider_event_id,
           event_type,
           status,
           payload_sha256,
           received_at
         )
         VALUES ($1, $2, $3, 'received', $4, NOW())
         ON CONFLICT (provider, provider_event_id) DO NOTHING
         RETURNING id\`,
        [event.provider, event.providerEventId, event.eventType, payloadSha256]
      );

      if (!eventInsert.rows[0]) {
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, duplicate: true });
      }

      const eventRowId = eventInsert.rows[0].id;
      const accountResult = await client.query(
        \`SELECT user_id, status, verified_at, expires_at, last_event_at
         FROM account_age_verification
         WHERE provider = $1
           AND provider_reference_hash = $2
         LIMIT 1
         FOR UPDATE\`,
        [event.provider, providerReferenceHash]
      );
      const account = accountResult.rows[0] || null;

      if (!account) {
        await client.query(
          \`UPDATE age_verification_events
           SET status = 'failed',
               error_text = 'verification-reference-not-found',
               processed_at = NOW()
           WHERE id = $1\`,
          [eventRowId]
        );
        await client.query("COMMIT");
        return res.status(202).json({ ok: true, accepted: true });
      }

      const eventTime = new Date(event.occurredAt).getTime();
      const lastEventTime = account.last_event_at
        ? new Date(account.last_event_at).getTime()
        : 0;
      if (Number.isFinite(lastEventTime) && lastEventTime > eventTime) {
        await client.query(
          \`UPDATE age_verification_events
           SET user_id = $2,
               status = 'processed',
               error_text = 'ignored-stale-event',
               processed_at = NOW()
           WHERE id = $1\`,
          [eventRowId, account.user_id]
        );
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, ignored: true, reason: "stale-event" });
      }

      const transition = resolveAgeVerificationTransition(account.status, event.status);
      if (!transition.apply) {
        await client.query(
          \`UPDATE age_verification_events
           SET user_id = $2,
               status = 'processed',
               error_text = $3,
               processed_at = NOW()
           WHERE id = $1\`,
          [eventRowId, account.user_id, transition.reason || "transition-not-applied"]
        );
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, ignored: true, reason: transition.reason || "transition-not-applied" });
      }

      const nextVerifiedAt = event.status === "verified"
        ? event.verifiedAt
        : account.verified_at;
      const nextExpiresAt = event.expiresAt || account.expires_at;

      await client.query(
        \`UPDATE account_age_verification
         SET status = $2,
             age_threshold = 18,
             verified_at = $3,
             expires_at = $4,
             result_code = $5,
             last_event_at = $6,
             updated_at = NOW()
         WHERE user_id = $1\`,
        [
          account.user_id,
          transition.status,
          nextVerifiedAt,
          nextExpiresAt,
          event.resultCode,
          event.occurredAt
        ]
      );

      await client.query(
        \`UPDATE age_verification_events
         SET user_id = $2,
             status = 'processed',
             error_text = NULL,
             processed_at = NOW()
         WHERE id = $1\`,
        [eventRowId, account.user_id]
      );

      await client.query("COMMIT");
      return res.status(200).json({
        ok: true,
        processed: true,
        status: transition.status
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI AGE VERIFICATION WEBHOOK DATABASE ERROR:", error);
      return res.status(500).json({ error: "Could not persist age-verification webhook." });
    } finally {
      client.release();
    }
  }
);

`;
server = replaceOnce(server, adminAnchor, webhookRoute + adminAnchor, "age webhook route insertion");

fs.writeFileSync(serverPath, server);
console.log("Applied v0.42 authenticated age-verification webhook integration.");
