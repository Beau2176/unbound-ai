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
  getReferralSummary
} = require("./growth/store");`,
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
    `app.get(
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
