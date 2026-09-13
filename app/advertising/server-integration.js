const INTEGRATION_VERSION = "v0.78";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Advertising analytics integration marker is missing: ${label}.`);
    error.code = "ADVERTISING_ANALYTICS_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Advertising analytics integration marker is ambiguous: ${label}.`);
    error.code = "ADVERTISING_ANALYTICS_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateAdvertisingAnalyticsServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "ADVERTISING_ANALYTICS_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const gatewayImport = `const {\n  getAdvertisingPaymentStatus,\n  startAdvertisingCheckout,\n  processAdvertisingWebhook\n} = require("./advertising/gateway");`;
  source = replaceExactlyOnce(
    source,
    gatewayImport,
    `${gatewayImport}\nconst {\n  recordAdvertisingImpressions,\n  recordAdvertisingClick,\n  loadAdvertisingMetrics\n} = require("./advertising/analytics");`,
    "advertising-analytics-import"
  );

  const schemaMarker = `    CREATE INDEX IF NOT EXISTS advertising_orders_admin_idx\n      ON advertising_orders(review_status, payment_status, created_at DESC);\n\n    CREATE TABLE IF NOT EXISTS advertising_payment_events (`;
  const schemaReplacement = `    CREATE INDEX IF NOT EXISTS advertising_orders_admin_idx\n      ON advertising_orders(review_status, payment_status, created_at DESC);\n\n    CREATE TABLE IF NOT EXISTS advertising_metrics_daily (\n      order_id BIGINT NOT NULL REFERENCES advertising_orders(id) ON DELETE CASCADE,\n      event_date DATE NOT NULL DEFAULT CURRENT_DATE,\n      impressions BIGINT NOT NULL DEFAULT 0 CHECK (impressions >= 0),\n      clicks BIGINT NOT NULL DEFAULT 0 CHECK (clicks >= 0),\n      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      PRIMARY KEY (order_id, event_date)\n    );\n\n    CREATE INDEX IF NOT EXISTS advertising_metrics_daily_date_idx\n      ON advertising_metrics_daily(event_date DESC, order_id);\n\n    CREATE TABLE IF NOT EXISTS advertising_payment_events (`;
  source = replaceExactlyOnce(
    source,
    schemaMarker,
    schemaReplacement,
    "advertising-analytics-schema"
  );

  source = replaceExactlyOnce(
    source,
    "`SELECT business_name, website_url, headline, description, featured, ends_at",
    "`SELECT id, business_name, website_url, headline, description, featured, ends_at",
    "advertising-catalog-id"
  );

  const catalogReturnMarker = `       ORDER BY featured DESC, starts_at DESC\n       LIMIT 100\`\n    );\n\n    return res.json({`;
  const catalogReturnReplacement = `       ORDER BY featured DESC, starts_at DESC\n       LIMIT 100\`\n    );\n\n    await recordAdvertisingImpressions(\n      pool,\n      result.rows.map((row) => row.id)\n    ).catch((error) => {\n      console.warn("UNBOUND AI ADVERTISING IMPRESSION METRICS WARNING:", error?.message || error);\n    });\n\n    return res.json({`;
  source = replaceExactlyOnce(
    source,
    catalogReturnMarker,
    catalogReturnReplacement,
    "advertising-catalog-impressions"
  );

  const catalogMapMarker = `      ads: result.rows.map((row) => ({\n        businessName: row.business_name,`;
  source = replaceExactlyOnce(
    source,
    catalogMapMarker,
    `      ads: result.rows.map((row) => ({\n        id: String(row.id),\n        businessName: row.business_name,`,
    "advertising-catalog-public-id"
  );

  const ordersRouteMarker = `});\n\napp.post("/api/advertising/orders", requireDatabase, registerRateLimit, async (req, res) => {`;
  const clickRoute = `});\n\napp.post("/api/advertising/metrics/click", requireDatabase, async (req, res) => {\n  const orderId = Number.parseInt(String(req.body?.orderId || ""), 10);\n  if (!Number.isSafeInteger(orderId) || orderId <= 0) {\n    return res.status(400).json({ error: "Advertising metric request is invalid." });\n  }\n\n  try {\n    const recorded = await recordAdvertisingClick(pool, orderId);\n    if (!recorded) {\n      return res.status(404).json({ error: "Active advertiser placement was not found." });\n    }\n    return res.status(204).end();\n  } catch (error) {\n    console.error("UNBOUND AI ADVERTISING CLICK METRICS ERROR:", error);\n    return res.status(500).json({ error: "Could not record advertising metric." });\n  }\n});\n\napp.post("/api/advertising/orders", requireDatabase, registerRateLimit, async (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    ordersRouteMarker,
    clickRoute,
    "advertising-click-route"
  );

  const adminOrdersMarker = `app.get("/api/admin/advertising/orders", requireDatabase, requireAdmin, async (req, res) => {`;
  const adminMetricsRoute = `app.get("/api/admin/advertising/metrics", requireDatabase, requireAdmin, async (req, res) => {\n  try {\n    const metrics = await loadAdvertisingMetrics(pool, { days: req.query.days });\n    return res.json(metrics);\n  } catch (error) {\n    console.error("UNBOUND AI ADVERTISING ADMIN METRICS ERROR:", error);\n    return res.status(500).json({ error: "Could not load advertising metrics." });\n  }\n});\n\n${adminOrdersMarker}`;
  source = replaceExactlyOnce(
    source,
    adminOrdersMarker,
    adminMetricsRoute,
    "advertising-admin-metrics-route"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateAdvertisingAnalyticsServerSource
};
