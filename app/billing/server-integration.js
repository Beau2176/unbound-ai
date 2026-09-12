const INTEGRATION_VERSION = "v0.59";

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
    const error = new Error("Billing webhook integration block could not be located safely.");
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
