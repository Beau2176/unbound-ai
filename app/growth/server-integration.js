"use strict";

const INTEGRATION_VERSION = "v1.0";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Growth integration marker is missing: ${label}.`);
    error.code = "GROWTH_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Growth integration marker is ambiguous: ${label}.`);
    error.code = "GROWTH_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateGrowthServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "GROWTH_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const importMarker = 'const { buildLaunchReadiness } = require("./ops/launch-readiness");';
  source = replaceExactlyOnce(
    source,
    importMarker,
    `${importMarker}
const {
  initializeGrowthSchema,
  captureRegistrationGrowth,
  recordGrowthEvent,
  getReferralSummary,
  createGrowthPartnerCode,
  setGrowthPartnerActive,
  listGrowthPartnerCodes,
  getGrowthAdminSummary
} = require("./growth/store");
const {
  FEATURE_LANDING_PAGES,
  sendFeatureLandingPage
} = require("./growth/landing-pages");`,
    "imports"
  );

  const schemaMarker = "  await initializeEmailVerificationSchema(pool);";
  source = replaceExactlyOnce(
    source,
    schemaMarker,
    `${schemaMarker}
  await initializeGrowthSchema(pool);`,
    "schema"
  );

  const registrationResponse = `    return res.status(201).json({
      user: publicUser(user)
    });`;
  source = replaceExactlyOnce(
    source,
    registrationResponse,
    `    let growth = null;
    try {
      growth = await captureRegistrationGrowth({
        pool,
        userId: user.id,
        acquisition: req.body?.acquisition
      });
    } catch (growthError) {
      console.error("UNBOUND AI REGISTRATION GROWTH ATTRIBUTION ERROR:", growthError);
    }

    return res.status(201).json({
      user: publicUser(user),
      growth
    });`,
    "registration-attribution"
  );

  const healthMarker = 'app.get("/api/health", (req, res) => {';
  source = replaceExactlyOnce(
    source,
    healthMarker,
    `for (const featureLanding of FEATURE_LANDING_PAGES) {
  app.get(featureLanding.path, async (req, res) => {
    if (databaseReady && pool) {
      try {
        await recordGrowthEvent(pool, {
          eventName: "landing_view",
          acquisition: {
            source: req.query?.utm_source,
            medium: req.query?.utm_medium,
            campaign: req.query?.utm_campaign,
            content: req.query?.utm_content,
            landingPath: featureLanding.path
          },
          metadata: { feature: featureLanding.id }
        });
      } catch (growthError) {
        console.warn("UNBOUND AI LANDING VIEW GROWTH EVENT ERROR:", growthError);
      }
    }
    return sendFeatureLandingPage(req, res);
  });
}

app.get("/growth-admin", requireDatabase, requireAdmin, (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "growth-admin.html"));
});

app.get(
  "/api/admin/growth/summary",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const summary = await getGrowthAdminSummary(pool, req.query?.days);
      return res.json({ summary });
    } catch (error) {
      console.error("UNBOUND AI GROWTH SUMMARY ERROR:", error);
      return res.status(500).json({ error: "Could not load growth summary." });
    }
  }
);

app.get(
  "/api/admin/growth/partners",
  requireDatabase,
  requireAdmin,
  async (req, res) => {
    try {
      const partners = await listGrowthPartnerCodes(pool);
      return res.json({ partners });
    } catch (error) {
      console.error("UNBOUND AI GROWTH PARTNER LIST ERROR:", error);
      return res.status(500).json({ error: "Could not load partner attribution codes." });
    }
  }
);

app.post(
  "/api/admin/growth/partners",
  requireDatabase,
  requireAdmin,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const partner = await createGrowthPartnerCode(pool, {
        code: req.body?.code,
        label: req.body?.label
      });
      return res.status(201).json({ partner });
    } catch (error) {
      if (error?.code === "GROWTH_PARTNER_INPUT_INVALID") {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      if (error?.code === "GROWTH_PARTNER_CODE_EXISTS") {
        return res.status(409).json({ error: error.message, code: error.code });
      }
      console.error("UNBOUND AI GROWTH PARTNER CREATE ERROR:", error);
      return res.status(500).json({ error: "Could not create partner attribution code." });
    }
  }
);

app.patch(
  "/api/admin/growth/partners/:code",
  requireDatabase,
  requireAdmin,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const active = req.body?.active;
      if (typeof active !== "boolean") {
        return res.status(400).json({ error: "active must be true or false." });
      }
      const partner = await setGrowthPartnerActive(pool, req.params.code, active);
      if (!partner) {
        return res.status(404).json({ error: "Partner attribution code was not found." });
      }
      return res.json({ partner });
    } catch (error) {
      if (error?.code === "GROWTH_PARTNER_INPUT_INVALID") {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      console.error("UNBOUND AI GROWTH PARTNER UPDATE ERROR:", error);
      return res.status(500).json({ error: "Could not update partner attribution code." });
    }
  }
);

app.get(
  "/api/account/referral",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const referral = await getReferralSummary(
        pool,
        req.user.id,
        process.env.PUBLIC_APP_ORIGIN || ""
      );
      await recordGrowthEvent(pool, {
        userId: req.user.id,
        eventName: "referral_link_viewed",
        metadata: { referredAccounts: referral.referredAccounts }
      });
      return res.json({ referral });
    } catch (error) {
      console.error("UNBOUND AI REFERRAL SUMMARY ERROR:", error);
      return res.status(500).json({ error: "Could not load your referral link." });
    }
  }
);

${healthMarker}`,
    "referral-route"
  );

  const billingLifecycleMarker = `      await client.query(
        \`UPDATE billing_webhook_events
         SET status = 'processed', error_text = NULL, processed_at = NOW()
         WHERE id = $1\`,
        [eventRowId]
      );

      await client.query("COMMIT");
      return sendBillingWebhookSuccess(res, 200);`;
  source = replaceExactlyOnce(
    source,
    billingLifecycleMarker,
    `      await client.query(
        \`UPDATE billing_webhook_events
         SET status = 'processed', error_text = NULL, processed_at = NOW()
         WHERE id = $1\`,
        [eventRowId]
      );

      const wasPaid = subscriptionStatusAllowsAccess(subscription.status);
      const isPaid = subscriptionStatusAllowsAccess(event.status);
      if (!wasPaid && isPaid) {
        await recordGrowthEvent(client, {
          userId: subscription.user_id,
          eventName: "subscription_activated",
          planTier: event.planTier || subscription.plan_tier,
          metadata: { provider: event.provider }
        });
      } else if (wasPaid && !isPaid && ["canceled", "unpaid"].includes(event.status)) {
        await recordGrowthEvent(client, {
          userId: subscription.user_id,
          eventName: "subscription_churned",
          planTier: event.planTier || subscription.plan_tier,
          metadata: { provider: event.provider, status: event.status }
        });
      }

      await client.query("COMMIT");
      return sendBillingWebhookSuccess(res, 200);`,
    "billing-lifecycle-events"
  );

  const checkoutResponse = `      return res.status(201).json({
        checkout: {`;
  source = replaceExactlyOnce(
    source,
    checkoutResponse,
    `      try {
        await recordGrowthEvent(pool, {
          userId: req.user.id,
          eventName: "checkout_started",
          planTier: requestedPlan,
          metadata: { provider: session.provider }
        });
      } catch (growthError) {
        console.error("UNBOUND AI CHECKOUT GROWTH EVENT ERROR:", growthError);
      }

${checkoutResponse}`,
    "checkout-event"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  integrateGrowthServerSource,
  replaceExactlyOnce
};
