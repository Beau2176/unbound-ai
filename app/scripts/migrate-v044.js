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

const oldBillingImport = `const {
  normalizeSubscriptionStatus,
  subscriptionStatusAllowsAccess,
  getBillingGatewayStatus
} = require("./billing/gateway");`;
const newBillingImport = `const {
  normalizeSubscriptionStatus,
  subscriptionStatusAllowsAccess,
  getBillingGatewayStatus,
  startBillingCheckoutSession,
  startBillingPortalSession,
  processBillingWebhook
} = require("./billing/gateway");`;
server = replaceOnce(server, oldBillingImport, newBillingImport, "billing gateway imports");

const webhookConstantAnchor = `const AGE_VERIFICATION_WEBHOOK_PATH = "/api/webhooks/age-verification";`;
server = replaceOnce(
  server,
  webhookConstantAnchor,
  `${webhookConstantAnchor}\nconst BILLING_WEBHOOK_PATH = "/api/webhooks/billing";`,
  "billing webhook path constant"
);

const oldParserBlock = `app.use(
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
const jsonBodyParser = express.json({ limit: "100kb" });
app.use((req, res, next) => {
  if (req.path === AGE_VERIFICATION_WEBHOOK_PATH) return next();
  return jsonBodyParser(req, res, next);
});`;
const newParserBlock = `app.use(
  createSameOriginApiGuard({
    isProduction: IS_PRODUCTION,
    publicOrigin: process.env.PUBLIC_APP_ORIGIN || "",
    exemptPaths: [AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH]
  })
);
app.use(
  AGE_VERIFICATION_WEBHOOK_PATH,
  express.raw({ type: "*/*", limit: "100kb" })
);
app.use(
  BILLING_WEBHOOK_PATH,
  express.raw({ type: "*/*", limit: "100kb" })
);
const jsonBodyParser = express.json({ limit: "100kb" });
app.use((req, res, next) => {
  if (
    req.path === AGE_VERIFICATION_WEBHOOK_PATH ||
    req.path === BILLING_WEBHOOK_PATH
  ) return next();
  return jsonBodyParser(req, res, next);
});`;
server = replaceOnce(server, oldParserBlock, newParserBlock, "webhook raw-body parser expansion");

const subscriptionIndexAnchor = `    CREATE UNIQUE INDEX IF NOT EXISTS account_subscriptions_provider_subscription_idx
      ON account_subscriptions(provider, provider_subscription_id)
      WHERE provider_subscription_id IS NOT NULL;`;
const subscriptionSchemaExpansion = `    ALTER TABLE account_subscriptions
      ADD COLUMN IF NOT EXISTS provider_subject_hash TEXT;

    ALTER TABLE account_subscriptions
      ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;

    CREATE UNIQUE INDEX IF NOT EXISTS account_subscriptions_provider_subject_idx
      ON account_subscriptions(provider, provider_subject_hash)
      WHERE provider_subject_hash IS NOT NULL;

${subscriptionIndexAnchor}`;
server = replaceOnce(
  server,
  subscriptionIndexAnchor,
  subscriptionSchemaExpansion,
  "subscription subject/event schema expansion"
);

const billingEventIndexAnchor = `    CREATE INDEX IF NOT EXISTS billing_webhook_events_received_idx
      ON billing_webhook_events(received_at DESC);`;
const billingEventSchemaExpansion = `    ALTER TABLE billing_webhook_events
      ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

${billingEventIndexAnchor}`;
server = replaceOnce(
  server,
  billingEventIndexAnchor,
  billingEventSchemaExpansion,
  "billing event user linkage schema expansion"
);

const subscriptionLoaderAnchor = `async function loadAccountSubscription(userId, client = pool) {`;
const billingHelpers = `function billingHmac(value, purpose) {
  const secret = process.env.BILLING_HASH_SECRET || RATE_LIMIT_SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update(\`${'${purpose}'}:${'${String(value || "")}'}\`)
    .digest("hex");
}

function billingSubject(userId) {
  return billingHmac(userId, "subject");
}

function hashBillingSubject(subject) {
  return billingHmac(subject, "provider-subject");
}

`;
server = replaceOnce(
  server,
  subscriptionLoaderAnchor,
  billingHelpers + subscriptionLoaderAnchor,
  "billing privacy helper insertion"
);

const conversationAnchor = `/* ------------------------- CONVERSATION HISTORY ------------------------ */`;
const accountBillingRoutes = `app.post(
  "/api/account/billing/checkout",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    const gateway = getBillingGatewayStatus();
    if (!gateway.configured || !gateway.checkout) {
      return res.status(503).json({
        error: "Billing checkout is not connected yet.",
        gateway
      });
    }

    try {
      const currentResult = await pool.query(
        \`SELECT provider, status, plan_tier
         FROM account_subscriptions
         WHERE user_id = $1
         LIMIT 1\`,
        [req.user.id]
      );
      const current = currentResult.rows[0] || null;
      if (
        current &&
        subscriptionStatusAllowsAccess(current.status) &&
        normalizePlanTier(current.plan_tier) === "top"
      ) {
        return res.status(409).json({
          error: "This account already has active TOP subscription access."
        });
      }

      const subject = billingSubject(req.user.id);
      const subjectHash = hashBillingSubject(subject);

      await pool.query(
        \`INSERT INTO account_subscriptions (
           user_id,
           provider,
           provider_subject_hash,
           status,
           plan_tier,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, 'incomplete', 'top', NOW(), NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           provider_customer_id = CASE
             WHEN account_subscriptions.provider = EXCLUDED.provider
               THEN account_subscriptions.provider_customer_id
             ELSE NULL
           END,
           provider_subscription_id = CASE
             WHEN account_subscriptions.provider = EXCLUDED.provider
               THEN account_subscriptions.provider_subscription_id
             ELSE NULL
           END,
           provider = EXCLUDED.provider,
           provider_subject_hash = EXCLUDED.provider_subject_hash,
           status = 'incomplete',
           plan_tier = 'top',
           current_period_start = NULL,
           current_period_end = NULL,
           cancel_at_period_end = FALSE,
           last_event_at = NULL,
           updated_at = NOW()\`,
        [req.user.id, gateway.provider, subjectHash]
      );

      const session = await startBillingCheckoutSession({
        subject,
        planTier: "top",
        successUrl: process.env.BILLING_SUCCESS_URL || null,
        cancelUrl: process.env.BILLING_CANCEL_URL || null,
        requestId: req.requestId || null
      });

      await pool.query(
        \`UPDATE account_subscriptions
         SET provider_customer_id = COALESCE($2, provider_customer_id),
             provider_subscription_id = COALESCE($3, provider_subscription_id),
             updated_at = NOW()
         WHERE user_id = $1\`,
        [
          req.user.id,
          session.customerReference,
          session.subscriptionReference
        ]
      );

      return res.status(201).json({
        checkout: {
          provider: session.provider,
          planTier: "top",
          checkoutUrl: session.checkoutUrl
        },
        gateway: getBillingGatewayStatus()
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("BILLING_")) {
        return res.status(Number(error.statusCode) || 503).json({
          error: error.publicMessage || "Billing checkout is unavailable.",
          code: error.code,
          gateway: getBillingGatewayStatus()
        });
      }
      console.error("UNBOUND AI BILLING CHECKOUT ERROR:", error);
      return res.status(500).json({ error: "Could not start billing checkout." });
    }
  }
);

app.post(
  "/api/account/billing/portal",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    const gateway = getBillingGatewayStatus();
    if (!gateway.configured || !gateway.customerPortal) {
      return res.status(503).json({
        error: "Billing customer portal is not connected yet.",
        gateway
      });
    }

    try {
      const result = await pool.query(
        \`SELECT provider, provider_customer_id
         FROM account_subscriptions
         WHERE user_id = $1
         LIMIT 1\`,
        [req.user.id]
      );
      const subscription = result.rows[0] || null;
      if (
        !subscription?.provider_customer_id ||
        subscription.provider !== gateway.provider
      ) {
        return res.status(409).json({
          error: "No payment-provider customer is connected to this account yet."
        });
      }

      const session = await startBillingPortalSession({
        customerReference: subscription.provider_customer_id,
        returnUrl: process.env.BILLING_PORTAL_RETURN_URL || null,
        requestId: req.requestId || null
      });

      return res.json({
        portal: {
          provider: session.provider,
          portalUrl: session.portalUrl
        },
        gateway: getBillingGatewayStatus()
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("BILLING_")) {
        return res.status(Number(error.statusCode) || 503).json({
          error: error.publicMessage || "Billing customer portal is unavailable.",
          code: error.code,
          gateway: getBillingGatewayStatus()
        });
      }
      console.error("UNBOUND AI BILLING PORTAL ERROR:", error);
      return res.status(500).json({ error: "Could not open billing customer portal." });
    }
  }
);

`;
server = replaceOnce(
  server,
  conversationAnchor,
  accountBillingRoutes + conversationAnchor,
  "account billing route insertion"
);

const adminAnchor = `/* ----------------------------- ADMIN API ----------------------------- */`;
const billingWebhookRoute = `app.post(
  BILLING_WEBHOOK_PATH,
  requireDatabase,
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");
    let event;

    try {
      event = await processBillingWebhook({
        rawBody,
        headers: req.headers,
        requestId: req.requestId || null
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("BILLING_")) {
        return res.status(Number(error.statusCode) || 400).json({
          error: error.publicMessage || "Billing webhook rejected.",
          code: error.code
        });
      }
      console.error("UNBOUND AI BILLING WEBHOOK VERIFY ERROR:", error);
      return res.status(500).json({ error: "Could not process billing webhook." });
    }

    const subjectHash = event.subject ? hashBillingSubject(event.subject) : null;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        \`INSERT INTO billing_webhook_events (
           provider,
           provider_event_id,
           event_type,
           status,
           payload_sha256,
           received_at
         )
         VALUES ($1, $2, $3, 'received', $4, NOW())
         ON CONFLICT (provider, provider_event_id) DO NOTHING\`,
        [event.provider, event.providerEventId, event.eventType, payloadSha256]
      );

      const eventResult = await client.query(
        \`SELECT id, status, processed_at
         FROM billing_webhook_events
         WHERE provider = $1 AND provider_event_id = $2
         LIMIT 1
         FOR UPDATE\`,
        [event.provider, event.providerEventId]
      );
      const eventRow = eventResult.rows[0];
      if (!eventRow) {
        throw new Error("Billing webhook event row was not created.");
      }
      if (eventRow.processed_at) {
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, duplicate: true });
      }

      let subscriptionRows = [];
      if (event.subscriptionReference) {
        const match = await client.query(
          \`SELECT *
           FROM account_subscriptions
           WHERE provider = $1 AND provider_subscription_id = $2
           LIMIT 1
           FOR UPDATE\`,
          [event.provider, event.subscriptionReference]
        );
        subscriptionRows = match.rows;
      }
      if (!subscriptionRows.length && subjectHash) {
        const match = await client.query(
          \`SELECT *
           FROM account_subscriptions
           WHERE provider = $1 AND provider_subject_hash = $2
           LIMIT 1
           FOR UPDATE\`,
          [event.provider, subjectHash]
        );
        subscriptionRows = match.rows;
      }
      if (!subscriptionRows.length && event.customerReference) {
        const match = await client.query(
          \`SELECT *
           FROM account_subscriptions
           WHERE provider = $1 AND provider_customer_id = $2
           LIMIT 2
           FOR UPDATE\`,
          [event.provider, event.customerReference]
        );
        if (match.rows.length > 1) {
          await client.query(
            \`UPDATE billing_webhook_events
             SET status = 'failed',
                 error_text = 'ambiguous-customer-reference'
             WHERE id = $1\`,
            [eventRow.id]
          );
          await client.query("COMMIT");
          return res.status(202).json({ ok: true, accepted: true });
        }
        subscriptionRows = match.rows;
      }

      const subscription = subscriptionRows[0] || null;
      if (!subscription) {
        await client.query(
          \`UPDATE billing_webhook_events
           SET status = 'received',
               error_text = 'subscription-reference-not-found',
               processed_at = NULL
           WHERE id = $1\`,
          [eventRow.id]
        );
        await client.query("COMMIT");
        return res.status(202).json({ ok: true, accepted: true });
      }

      const eventTime = new Date(event.occurredAt).getTime();
      const lastEventTime = subscription.last_event_at
        ? new Date(subscription.last_event_at).getTime()
        : 0;
      if (Number.isFinite(lastEventTime) && lastEventTime > eventTime) {
        await client.query(
          \`UPDATE billing_webhook_events
           SET user_id = $2,
               status = 'processed',
               error_text = 'ignored-stale-event',
               processed_at = NOW()
           WHERE id = $1\`,
          [eventRow.id, subscription.user_id]
        );
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, ignored: true, reason: "stale-event" });
      }

      await client.query(
        \`UPDATE account_subscriptions
         SET provider_customer_id = COALESCE($2, provider_customer_id),
             provider_subscription_id = COALESCE($3, provider_subscription_id),
             status = $4,
             plan_tier = 'top',
             current_period_start = COALESCE($5, current_period_start),
             current_period_end = COALESCE($6, current_period_end),
             cancel_at_period_end = $7,
             last_event_at = $8,
             updated_at = NOW()
         WHERE user_id = $1\`,
        [
          subscription.user_id,
          event.customerReference,
          event.subscriptionReference,
          event.status,
          event.currentPeriodStart,
          event.currentPeriodEnd,
          event.cancelAtPeriodEnd,
          event.occurredAt
        ]
      );

      await client.query(
        \`UPDATE billing_webhook_events
         SET user_id = $2,
             status = 'processed',
             error_text = NULL,
             processed_at = NOW()
         WHERE id = $1\`,
        [eventRow.id, subscription.user_id]
      );

      await client.query("COMMIT");
      return res.status(200).json({
        ok: true,
        processed: true,
        status: event.status
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("UNBOUND AI BILLING WEBHOOK DATABASE ERROR:", error);
      return res.status(500).json({ error: "Could not persist billing webhook." });
    } finally {
      client.release();
    }
  }
);

`;
server = replaceOnce(
  server,
  adminAnchor,
  billingWebhookRoute + adminAnchor,
  "billing webhook route insertion"
);

fs.writeFileSync(serverPath, server);
console.log("Applied v0.44 provider-neutral billing server integration.");
