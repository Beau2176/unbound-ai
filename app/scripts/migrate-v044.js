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

const importAnchor = `const {
  normalizeSubscriptionStatus,
  subscriptionStatusAllowsAccess,
  getBillingGatewayStatus
} = require("./billing/gateway");`;
const importReplacement = `const {
  normalizeSubscriptionStatus,
  subscriptionStatusAllowsAccess,
  getBillingGatewayStatus,
  startBillingCheckoutSession,
  startBillingCustomerPortalSession
} = require("./billing/gateway");`;
server = replaceOnce(server, importAnchor, importReplacement, "billing gateway imports");

const helperAnchor = `function ageVerificationSubject(userId) {
  return ageVerificationHmac(userId, "subject");
}`;
const helperReplacement = `function billingSubject(userId) {
  const secret = process.env.BILLING_SUBJECT_SECRET || RATE_LIMIT_SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update(\`billing:\${String(userId || "")}\`)
    .digest("hex");
}

${helperAnchor}`;
server = replaceOnce(server, helperAnchor, helperReplacement, "billing subject helper");

const routeAnchor = `app.get(
  "/api/account/age-verification",`;
const billingRoutes = `app.post(
  "/api/account/billing/checkout",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const access = await buildAccountAccess(req.user);
      if (access?.plan?.tier === "top") {
        return res.status(409).json({
          error: "This account already has TOP access.",
          gateway: getBillingGatewayStatus()
        });
      }

      const session = await startBillingCheckoutSession({
        subject: billingSubject(req.user.id),
        email: req.user.email,
        planTier: "top",
        successUrl: process.env.BILLING_SUCCESS_URL || null,
        cancelUrl: process.env.BILLING_CANCEL_URL || null,
        requestId: req.requestId || null
      });

      return res.status(201).json({
        checkout: {
          provider: session.provider,
          checkoutUrl: session.checkoutUrl,
          expiresAt: session.expiresAt
        },
        gateway: getBillingGatewayStatus()
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("BILLING_")) {
        return res.status(Number(error.statusCode) || 503).json({
          error: error.publicMessage || "Subscription checkout is unavailable.",
          code: error.code,
          gateway: getBillingGatewayStatus()
        });
      }
      console.error("UNBOUND AI BILLING CHECKOUT ERROR:", error);
      return res.status(500).json({ error: "Could not start subscription checkout." });
    }
  }
);

app.post(
  "/api/account/billing/portal",
  requireDatabase,
  requireSignedIn,
  securityActionRateLimit,
  async (req, res) => {
    try {
      const gateway = getBillingGatewayStatus();
      const result = await pool.query(
        \`SELECT provider, provider_customer_id
         FROM account_subscriptions
         WHERE user_id = $1
         LIMIT 1\`,
        [req.user.id]
      );
      const subscription = result.rows[0] || null;
      const storedProvider = String(subscription?.provider || "").trim().toLowerCase();
      const customerId = String(subscription?.provider_customer_id || "").trim();

      if (!customerId || !storedProvider) {
        return res.status(409).json({
          error: "No billing customer is connected to this account yet.",
          gateway
        });
      }
      if (!gateway.provider || storedProvider !== gateway.provider) {
        return res.status(409).json({
          error: "The stored billing customer does not match the active billing provider.",
          gateway
        });
      }

      const session = await startBillingCustomerPortalSession({
        subject: billingSubject(req.user.id),
        email: req.user.email,
        providerCustomerId: customerId,
        returnUrl: process.env.BILLING_PORTAL_RETURN_URL || null,
        requestId: req.requestId || null
      });

      return res.status(201).json({
        portal: {
          provider: session.provider,
          portalUrl: session.portalUrl,
          expiresAt: session.expiresAt
        },
        gateway: getBillingGatewayStatus()
      });
    } catch (error) {
      if (String(error?.code || "").startsWith("BILLING_")) {
        return res.status(Number(error.statusCode) || 503).json({
          error: error.publicMessage || "Subscription management is unavailable.",
          code: error.code,
          gateway: getBillingGatewayStatus()
        });
      }
      console.error("UNBOUND AI BILLING PORTAL ERROR:", error);
      return res.status(500).json({ error: "Could not open subscription management." });
    }
  }
);

${routeAnchor}`;
server = replaceOnce(server, routeAnchor, billingRoutes, "billing account routes");

fs.writeFileSync(serverPath, server);
console.log("Applied v0.44 billing session server integration.");
