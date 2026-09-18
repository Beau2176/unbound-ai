const INTEGRATION_VERSION = "v1.0";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Billing integration marker is missing: ${label}.`);
    error.code = "BILLING_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Billing integration marker is ambiguous: ${label}.`);
    error.code = "BILLING_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function replaceInsideBlock(source, startMarker, endMarker, mutate) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1 || end <= start) {
    const error = new Error("Billing integration block could not be located safely.");
    error.code = "BILLING_SERVER_INTEGRATION_BLOCK_MISSING";
    throw error;
  }
  const block = source.slice(start, end);
  const nextBlock = mutate(block);
  return source.slice(0, start) + nextBlock + source.slice(end);
}

function integrateBillingServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "BILLING_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const checkoutStart = `app.post(\n  "/api/account/billing/checkout",\n  requireDatabase,\n  requireSignedIn,\n  securityActionRateLimit,\n  async (req, res) => {`;
  const portalStart = `app.post(\n  "/api/account/billing/portal",`;

  source = replaceInsideBlock(source, checkoutStart, portalStart, (blockSource) => {
    let block = blockSource;

    block = replaceExactlyOnce(
      block,
      `      const access = await buildAccountAccess(req.user);\n      if (access?.plan?.tier === "top") {\n        return res.status(409).json({\n          error: "This account already has TOP access.",\n          gateway: getBillingGatewayStatus()\n        });\n      }\n\n      const subject = billingSubject(req.user.id);`,
      `      const requestedPlan = normalizePlanTier(req.body?.planTier);
      const billingGateway = getBillingGatewayStatus();
      if (!billingGateway.paidPlans.includes(requestedPlan)) {
        const availablePlans = billingGateway.paidPlans
          .map((tier) => {
            const plan = getPlanDefinition(tier);
            return plan.displayName + " ($" + plan.priceMonthlyUsd.toFixed(2) + "/month)";
          })
          .join(" or ");
        return res.status(400).json({
          error: "Choose " + (availablePlans || "a currently available paid plan") + ".",
          code: "BILLING_PLAN_INVALID",
          gateway: billingGateway
        });
      }

      const access = await buildAccountAccess(req.user);\n      const currentPlan = getPlanDefinition(access?.plan?.tier);\n      const targetPlan = getPlanDefinition(requestedPlan);\n      const activePaidSubscription = Boolean(\n        access?.subscription?.connected &&\n        subscriptionStatusAllowsAccess(access?.subscription?.status)\n      );\n\n      if (currentPlan.rank >= targetPlan.rank) {\n        return res.status(409).json({\n          error:\n            currentPlan.id === targetPlan.id\n              ? "This account already has " + targetPlan.displayName + " access."\n              : "This account already has a higher " + currentPlan.displayName + " access level.",\n          code: "BILLING_PLAN_ALREADY_INCLUDED",\n          gateway: getBillingGatewayStatus()\n        });\n      }\n\n      if (activePaidSubscription) {\n        return res.status(409).json({\n          error: "Use Manage Billing for changes to an active paid subscription. This prevents access from changing before the billing provider confirms the plan change.",\n          code: "BILLING_ACTIVE_PLAN_CHANGE_REQUIRES_PORTAL",\n          gateway: getBillingGatewayStatus()\n        });\n      }\n\n      const subject = billingSubject(req.user.id);`,
      "three-tier-checkout-validation"
    );

    block = replaceExactlyOnce(
      block,
      `        planTier: "top",`,
      `        planTier: requestedPlan,`,
      "three-tier-checkout-plan"
    );

    block = replaceExactlyOnce(
      block,
      `         VALUES ($1, $2, 'incomplete', 'top', $3, NOW(), NOW())`,
      `         VALUES ($1, $2, 'incomplete', $3, $4, NOW(), NOW())`,
      "three-tier-subscription-insert"
    );

    block = replaceExactlyOnce(
      block,
      `           plan_tier = 'top',`,
      `           plan_tier = EXCLUDED.plan_tier,`,
      "three-tier-subscription-update"
    );

    block = replaceExactlyOnce(
      block,
      `        [req.user.id, session.provider, subject]`,
      `        [req.user.id, session.provider, requestedPlan, subject]`,
      "three-tier-subscription-params"
    );

    block = replaceExactlyOnce(
      block,
      `          provider: session.provider,\n          checkoutUrl: session.checkoutUrl,`,
      `          provider: session.provider,\n          planTier: requestedPlan,\n          checkoutUrl: session.checkoutUrl,`,
      "three-tier-checkout-response"
    );

    return block;
  });

  const billingStart = `app.post(\n  BILLING_WEBHOOK_PATH,\n  requireDatabase,\n  async (req, res) => {`;
  const ageStart = `app.post(\n  AGE_VERIFICATION_WEBHOOK_PATH,`;

  source = replaceInsideBlock(source, billingStart, ageStart, (blockSource) => {
    let block = blockSource;
    block = replaceExactlyOnce(
      block,
      billingStart,
      `function sendBillingWebhookSuccess(res, statusCode = 200) {\n  return res.status(statusCode).type("text/plain").send("OK");\n}\n\nfunction billingWebhookPayloadBuffer(req) {\n  if (Buffer.isBuffer(req.body) && req.body.length > 0) return req.body;\n  const params = new URLSearchParams();\n  const query = req.query && typeof req.query === "object" ? req.query : {};\n  for (const key of Object.keys(query).sort()) {\n    const value = query[key];\n    for (const item of Array.isArray(value) ? value : [value]) {\n      if (item !== undefined && item !== null) params.append(key, String(item));\n    }\n  }\n  return Buffer.from(params.toString(), "utf8");\n}\n\napp.all(\n  BILLING_WEBHOOK_PATH,\n  requireDatabase,\n  async (req, res) => {`,
      "billing-route-method"
    );

    block = replaceExactlyOnce(
      block,
      `    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");\n    const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");`,
      `    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");\n    const payloadSha256 = crypto\n      .createHash("sha256")\n      .update(billingWebhookPayloadBuffer(req))\n      .digest("hex");`,
      "billing-payload-hash"
    );

    block = replaceExactlyOnce(
      block,
      `      event = await processBillingWebhook({\n        rawBody,\n        headers: req.headers,`,
      `      event = await processBillingWebhook({\n        rawBody,\n        query: req.query,\n        headers: req.headers,`,
      "billing-query-input"
    );

    block = replaceExactlyOnce(
      block,
      `             plan_tier = $5,`,
      `             plan_tier = COALESCE($5, plan_tier),`,
      "billing-preserve-plan-when-webhook-omits-plan"
    );

    block = replaceExactlyOnce(
      block,
      `        return res.status(200).json({ ok: true, duplicate: true });`,
      `        return sendBillingWebhookSuccess(res, 200);`,
      "billing-duplicate-response"
    );
    block = replaceExactlyOnce(
      block,
      `        return res.status(202).json({ ok: true, accepted: true });`,
      `        return sendBillingWebhookSuccess(res, 202);`,
      "billing-unmatched-response"
    );
    block = replaceExactlyOnce(
      block,
      `        return res.status(200).json({ ok: true, ignored: true, reason: "stale-event" });`,
      `        return sendBillingWebhookSuccess(res, 200);`,
      "billing-stale-response"
    );
    block = replaceExactlyOnce(
      block,
      `      return res.status(200).json({\n        ok: true,\n        processed: true,\n        status: event.status,\n        planTier: event.planTier\n      });`,
      `      return sendBillingWebhookSuccess(res, 200);`,
      "billing-processed-response"
    );
    return block;
  });

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  integrateBillingServerSource,
  replaceExactlyOnce,
  replaceInsideBlock
};
