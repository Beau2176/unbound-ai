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

server = replaceOnce(
  server,
  `  getBillingGatewayStatus,\n  startBillingCheckoutSession,\n  startBillingCustomerPortalSession\n} = require("./billing/gateway");`,
  `  getBillingGatewayStatus,\n  startBillingCheckoutSession,\n  startBillingCustomerPortalSession,\n  processBillingWebhook\n} = require("./billing/gateway");`,
  "billing webhook import"
);

server = replaceOnce(
  server,
  `const AGE_VERIFICATION_WEBHOOK_PATH = "/api/webhooks/age-verification";`,
  `const AGE_VERIFICATION_WEBHOOK_PATH = "/api/webhooks/age-verification";\nconst BILLING_WEBHOOK_PATH = "/api/webhooks/billing";\nconst RAW_WEBHOOK_PATHS = new Set([AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH]);`,
  "billing webhook path"
);

server = replaceOnce(
  server,
  `    exemptPaths: [AGE_VERIFICATION_WEBHOOK_PATH]\n  })\n);\napp.use(\n  AGE_VERIFICATION_WEBHOOK_PATH,\n  express.raw({ type: "*/*", limit: "100kb" })\n);\nconst jsonBodyParser = express.json({ limit: "100kb" });\napp.use((req, res, next) => {\n  if (req.path === AGE_VERIFICATION_WEBHOOK_PATH) return next();\n  return jsonBodyParser(req, res, next);\n});`,
  `    exemptPaths: [AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH]\n  })\n);\nfor (const webhookPath of RAW_WEBHOOK_PATHS) {\n  app.use(webhookPath, express.raw({ type: "*/*", limit: "100kb" }));\n}\nconst jsonBodyParser = express.json({ limit: "100kb" });\napp.use((req, res, next) => {\n  if (RAW_WEBHOOK_PATHS.has(req.path)) return next();\n  return jsonBodyParser(req, res, next);\n});`,
  "raw webhook parser"
);

server = replaceOnce(
  server,
  `    CREATE UNIQUE INDEX IF NOT EXISTS account_subscriptions_provider_subscription_idx\n      ON account_subscriptions(provider, provider_subscription_id)\n      WHERE provider_subscription_id IS NOT NULL;`,
  `    ALTER TABLE account_subscriptions\n      ADD COLUMN IF NOT EXISTS billing_subject_hash TEXT;\n\n    ALTER TABLE account_subscriptions\n      ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;\n\n    CREATE UNIQUE INDEX IF NOT EXISTS account_subscriptions_provider_subject_idx\n      ON account_subscriptions(provider, billing_subject_hash)\n      WHERE billing_subject_hash IS NOT NULL;\n\n    CREATE UNIQUE INDEX IF NOT EXISTS account_subscriptions_provider_subscription_idx\n      ON account_subscriptions(provider, provider_subscription_id)\n      WHERE provider_subscription_id IS NOT NULL;`,
  "billing subscription webhook schema"
);

server = replaceOnce(
  server,
  `      const session = await startBillingCheckoutSession({\n        subject: billingSubject(req.user.id),\n        email: req.user.email,`,
  `      const subject = billingSubject(req.user.id);\n      const session = await startBillingCheckoutSession({\n        subject,\n        email: req.user.email,`,
  "checkout billing subject"
);

server = replaceOnce(
  server,
  `      return res.status(201).json({\n        checkout: {\n          provider: session.provider,\n          checkoutUrl: session.checkoutUrl,\n          expiresAt: session.expiresAt\n        },\n        gateway: getBillingGatewayStatus()\n      });`,
  `      await pool.query(\n        \`INSERT INTO account_subscriptions (\n           user_id, provider, status, plan_tier, billing_subject_hash, created_at, updated_at\n         )\n         VALUES ($1, $2, 'incomplete', 'top', $3, NOW(), NOW())\n         ON CONFLICT (user_id)\n         DO UPDATE SET\n           provider = EXCLUDED.provider,\n           status = CASE\n             WHEN account_subscriptions.status IN ('active', 'trialing')\n               THEN account_subscriptions.status\n             ELSE 'incomplete'\n           END,\n           plan_tier = 'top',\n           billing_subject_hash = EXCLUDED.billing_subject_hash,\n           updated_at = NOW()\`,\n        [req.user.id, session.provider, subject]\n      );\n\n      return res.status(201).json({\n        checkout: {\n          provider: session.provider,\n          checkoutUrl: session.checkoutUrl,\n          expiresAt: session.expiresAt\n        },\n        gateway: getBillingGatewayStatus()\n      });`,
  "checkout subject persistence"
);

const webhookAnchor = `app.post(\n  AGE_VERIFICATION_WEBHOOK_PATH,`;
const billingWebhookRoute = `app.post(\n  BILLING_WEBHOOK_PATH,\n  requireDatabase,\n  async (req, res) => {\n    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");\n    const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");\n    let event;\n\n    try {\n      event = await processBillingWebhook({\n        rawBody,\n        headers: req.headers,\n        requestId: req.requestId || null\n      });\n    } catch (error) {\n      if (String(error?.code || "").startsWith("BILLING_")) {\n        return res.status(Number(error.statusCode) || 400).json({\n          error: error.publicMessage || "Billing webhook rejected.",\n          code: error.code\n        });\n      }\n      console.error("UNBOUND AI BILLING WEBHOOK VERIFY ERROR:", error);\n      return res.status(500).json({ error: "Could not process billing webhook." });\n    }\n\n    const client = await pool.connect();\n    try {\n      await client.query("BEGIN");\n\n      const eventInsert = await client.query(\n        \`INSERT INTO billing_webhook_events (\n           provider, provider_event_id, event_type, status, payload_sha256, received_at\n         )\n         VALUES ($1, $2, $3, 'received', $4, NOW())\n         ON CONFLICT (provider, provider_event_id) DO NOTHING\n         RETURNING id\`,\n        [event.provider, event.providerEventId, event.eventType, payloadSha256]\n      );\n\n      if (!eventInsert.rows[0]) {\n        await client.query("COMMIT");\n        return res.status(200).json({ ok: true, duplicate: true });\n      }\n\n      const eventRowId = eventInsert.rows[0].id;\n      const subscriptionResult = await client.query(\n        \`SELECT id, user_id, provider_customer_id, provider_subscription_id,\n                status, plan_tier, current_period_start, current_period_end,\n                cancel_at_period_end, last_event_at\n         FROM account_subscriptions\n         WHERE provider = $1 AND billing_subject_hash = $2\n         LIMIT 1\n         FOR UPDATE\`,\n        [event.provider, event.subject]\n      );\n      const subscription = subscriptionResult.rows[0] || null;\n\n      if (!subscription) {\n        await client.query(\n          \`UPDATE billing_webhook_events\n           SET status = 'failed', error_text = 'billing-subject-not-found', processed_at = NOW()\n           WHERE id = $1\`,\n          [eventRowId]\n        );\n        await client.query("COMMIT");\n        return res.status(202).json({ ok: true, accepted: true });\n      }\n\n      const eventTime = new Date(event.occurredAt).getTime();\n      const lastEventTime = subscription.last_event_at\n        ? new Date(subscription.last_event_at).getTime()\n        : 0;\n      if (Number.isFinite(lastEventTime) && lastEventTime > eventTime) {\n        await client.query(\n          \`UPDATE billing_webhook_events\n           SET status = 'processed', error_text = 'ignored-stale-event', processed_at = NOW()\n           WHERE id = $1\`,\n          [eventRowId]\n        );\n        await client.query("COMMIT");\n        return res.status(200).json({ ok: true, ignored: true, reason: "stale-event" });\n      }\n\n      if (event.providerSubscriptionId) {\n        const conflicting = await client.query(\n          \`SELECT user_id FROM account_subscriptions\n           WHERE provider = $1 AND provider_subscription_id = $2 AND user_id <> $3\n           LIMIT 1\`,\n          [event.provider, event.providerSubscriptionId, subscription.user_id]\n        );\n        if (conflicting.rows[0]) {\n          await client.query(\n            \`UPDATE billing_webhook_events\n             SET status = 'failed', error_text = 'provider-subscription-conflict', processed_at = NOW()\n             WHERE id = $1\`,\n            [eventRowId]\n          );\n          await client.query("COMMIT");\n          return res.status(409).json({ ok: false, error: "Billing subscription mapping conflict." });\n        }\n      }\n\n      await client.query(\n        \`UPDATE account_subscriptions\n         SET provider_customer_id = COALESCE($2, provider_customer_id),\n             provider_subscription_id = COALESCE($3, provider_subscription_id),\n             status = $4,\n             plan_tier = $5,\n             current_period_start = COALESCE($6, current_period_start),\n             current_period_end = COALESCE($7, current_period_end),\n             cancel_at_period_end = $8,\n             last_event_at = $9,\n             updated_at = NOW()\n         WHERE user_id = $1\`,\n        [\n          subscription.user_id,\n          event.providerCustomerId,\n          event.providerSubscriptionId,\n          event.status,\n          event.planTier,\n          event.currentPeriodStart,\n          event.currentPeriodEnd,\n          event.cancelAtPeriodEnd,\n          event.occurredAt\n        ]\n      );\n\n      await client.query(\n        \`UPDATE billing_webhook_events\n         SET status = 'processed', error_text = NULL, processed_at = NOW()\n         WHERE id = $1\`,\n        [eventRowId]\n      );\n\n      await client.query("COMMIT");\n      return res.status(200).json({\n        ok: true,\n        processed: true,\n        status: event.status,\n        planTier: event.planTier\n      });\n    } catch (error) {\n      try { await client.query("ROLLBACK"); } catch (_) {}\n      console.error("UNBOUND AI BILLING WEBHOOK DATABASE ERROR:", error);\n      return res.status(500).json({ error: "Could not persist billing webhook." });\n    } finally {\n      client.release();\n    }\n  }\n);\n\n${webhookAnchor}`;
server = replaceOnce(server, webhookAnchor, billingWebhookRoute, "billing webhook route");

fs.writeFileSync(serverPath, server);
console.log("Applied v0.45 authenticated billing webhook integration.");
