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

  const returnUrlMarker = `function advertisingReturnUrl(req, result) {`;
  const trackingHelper = `function advertisingTrackedUrl(req, orderId, fallbackUrl) {\n  let origin = String(process.env.PUBLIC_APP_ORIGIN || "").trim();\n  try {\n    if (origin) {\n      const parsed = new URL(origin);\n      origin = parsed.protocol === "https:" ? parsed.origin : "";\n    }\n  } catch (_) {\n    origin = "";\n  }\n\n  if (!origin && IS_PRODUCTION) {\n    const host = req.get("host");\n    if (host) origin = `https://${host}`;\n  }\n\n  if (!origin.startsWith("https://")) return fallbackUrl;\n  return `${origin}/api/advertising/click/${encodeURIComponent(String(orderId))}`;\n}\n\n${returnUrlMarker}`;
  source = replaceExactlyOnce(
    source,
    returnUrlMarker,
    trackingHelper,
    "advertising-tracked-url-helper"
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

  const websiteMarker = `        websiteUrl: row.website_url,`;
  source = replaceExactlyOnce(
    source,
    websiteMarker,
    `        websiteUrl: advertisingTrackedUrl(req, row.id, row.website_url),`,
    "advertising-catalog-tracked-url"
  );

  const ordersRouteMarker = `});\n\napp.post("/api/advertising/orders", requireDatabase, registerRateLimit, async (req, res) => {`;
  const clickRoute = `});\n\napp.get("/api/advertising/click/:id", requireDatabase, async (req, res) => {\n  const orderId = Number.parseInt(String(req.params.id || ""), 10);\n  if (!Number.isSafeInteger(orderId) || orderId <= 0) {\n    return res.status(404).send("Advertiser placement not found.");\n  }\n\n  try {\n    const targetResult = await pool.query(\n      \`SELECT website_url\n       FROM advertising_orders\n       WHERE id = $1\n         AND payment_status = 'paid'\n         AND review_status = 'approved'\n         AND starts_at IS NOT NULL\n         AND ends_at IS NOT NULL\n         AND starts_at <= NOW()\n         AND ends_at > NOW()\n       LIMIT 1\`,\n      [orderId]\n    );\n    const targetUrl = targetResult.rows[0]?.website_url;\n    if (!targetUrl) return res.status(404).send("Advertiser placement not found.");\n\n    let parsed;\n    try {\n      parsed = new URL(targetUrl);\n    } catch (_) {\n      return res.status(404).send("Advertiser placement not found.");\n    }\n    if (parsed.protocol !== "https:") {\n      return res.status(404).send("Advertiser placement not found.");\n    }\n\n    await recordAdvertisingClick(pool, orderId).catch((error) => {\n      console.warn("UNBOUND AI ADVERTISING CLICK METRICS WARNING:", error?.message || error);\n    });\n    res.setHeader("Cache-Control", "no-store");\n    return res.redirect(302, parsed.toString());\n  } catch (error) {\n    console.error("UNBOUND AI ADVERTISING CLICK REDIRECT ERROR:", error);\n    return res.status(500).send("Could not open advertiser placement.");\n  }\n});\n\napp.post("/api/advertising/orders", requireDatabase, registerRateLimit, async (req, res) => {`;
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
