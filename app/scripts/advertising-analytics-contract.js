const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  normalizeAdvertisingOrderId,
  normalizeAnalyticsWindowDays,
  recordAdvertisingImpressions,
  recordAdvertisingClick,
  loadAdvertisingMetrics
} = require("../advertising/analytics");
const {
  integrateAdvertisingAnalyticsServerSource
} = require("../advertising/server-integration");

const appRoot = path.resolve(__dirname, "..");

function testNormalization() {
  assert.equal(normalizeAdvertisingOrderId("42"), 42);
  assert.equal(normalizeAdvertisingOrderId("0"), null);
  assert.equal(normalizeAdvertisingOrderId("nope"), null);
  assert.equal(normalizeAnalyticsWindowDays("7"), 7);
  assert.equal(normalizeAnalyticsWindowDays("500"), 90);
  assert.equal(normalizeAnalyticsWindowDays("0"), 1);
  assert.equal(normalizeAnalyticsWindowDays("bad"), 30);
}

async function testImpressions() {
  let call = null;
  const pool = {
    async query(sql, values) {
      call = { sql, values };
      return { rowCount: 2, rows: [] };
    }
  };

  const recorded = await recordAdvertisingImpressions(pool, [4, "4", 7, 0, "bad"]);
  assert.equal(recorded, 2);
  assert.deepEqual(call.values, [[4, 7]]);
  assert.ok(call.sql.includes("advertising_metrics_daily"));
  assert.ok(call.sql.includes("impressions = advertising_metrics_daily.impressions + 1"));
  assert.ok(!call.sql.toLowerCase().includes("ip_address"));
  assert.ok(!call.sql.toLowerCase().includes("user_id"));
}

async function testClick() {
  let call = null;
  const pool = {
    async query(sql, values) {
      call = { sql, values };
      return { rows: [{ order_id: 9 }] };
    }
  };

  assert.equal(await recordAdvertisingClick(pool, 9), true);
  assert.deepEqual(call.values, [9]);
  assert.ok(call.sql.includes("payment_status = 'paid'"));
  assert.ok(call.sql.includes("review_status = 'approved'"));
  assert.ok(call.sql.includes("clicks = advertising_metrics_daily.clicks + 1"));
  assert.equal(await recordAdvertisingClick(pool, "bad"), false);
}

async function testReporting() {
  const pool = {
    async query(sql, values) {
      assert.deepEqual(values, [30]);
      assert.ok(sql.includes("CURRENT_DATE - ($1::integer - 1)"));
      return {
        rows: [
          {
            id: 1,
            business_name: "Example One",
            package_code: "featured",
            package_name: "Featured",
            featured: true,
            payment_status: "paid",
            review_status: "approved",
            starts_at: "2026-09-12T00:00:00Z",
            ends_at: "2026-10-12T00:00:00Z",
            impressions: "100",
            clicks: "5"
          },
          {
            id: 2,
            business_name: "Example Two",
            package_code: "monthly",
            package_name: "Monthly",
            featured: false,
            payment_status: "paid",
            review_status: "approved",
            starts_at: "2026-09-12T00:00:00Z",
            ends_at: "2026-10-12T00:00:00Z",
            impressions: "50",
            clicks: "10"
          }
        ]
      };
    }
  };

  const report = await loadAdvertisingMetrics(pool, { days: 30 });
  assert.equal(report.windowDays, 30);
  assert.equal(report.totals.impressions, 150);
  assert.equal(report.totals.clicks, 15);
  assert.equal(report.totals.clickThroughRate, 0.1);
  assert.equal(report.orders[0].clickThroughRate, 0.05);
  assert.equal(report.orders[1].clickThroughRate, 0.2);
}

function testIntegrationContract() {
  const server = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const integrated = integrateAdvertisingAnalyticsServerSource(server);
  const start = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  const admin = fs.readFileSync(path.join(appRoot, "advertising-admin.html"), "utf8");

  for (const needle of [
    "CREATE TABLE IF NOT EXISTS advertising_metrics_daily",
    'app.get("/api/advertising/click/:id"',
    'app.get("/api/admin/advertising/metrics"',
    "recordAdvertisingImpressions",
    "recordAdvertisingClick",
    "loadAdvertisingMetrics",
    "advertisingTrackedUrl(req, row.id, row.website_url)",
    "res.redirect(302, parsed.toString())"
  ]) {
    assert.ok(integrated.includes(needle), `Advertising analytics integration missing: ${needle}`);
  }

  assert.ok(
    integrated.indexOf("await recordAdvertisingClick(pool, orderId).catch") <
      integrated.indexOf("return res.redirect(302, parsed.toString())"),
    "Click accounting must be attempted before the outbound redirect."
  );
  assert.ok(
    integrated.includes("UNBOUND AI ADVERTISING CLICK METRICS WARNING"),
    "Click metrics failure must degrade without blocking the outbound link."
  );
  assert.ok(
    start.includes("integrateAdvertisingAnalyticsServerSource(integratedSource)"),
    "Production startup must apply advertising analytics integration."
  );
  assert.ok(admin.includes("Performance reporting is aggregate-only."));
  assert.ok(admin.includes("/api/admin/advertising/metrics?days="));
  assert.ok(admin.includes("Click-through rate"));

  for (const forbidden of ["ip_address", "user_agent", "visitor_id", "device_id"]) {
    assert.equal(
      integrated.toLowerCase().includes(`advertising_metrics_daily (\n      ${forbidden}`),
      false,
      `Advertising metrics table must not collect ${forbidden}.`
    );
  }

  assert.throws(
    () => integrateAdvertisingAnalyticsServerSource("const app = {};"),
    (error) => error.code === "ADVERTISING_ANALYTICS_SERVER_INTEGRATION_MARKER_MISSING"
  );
}

(async () => {
  testNormalization();
  await testImpressions();
  await testClick();
  await testReporting();
  testIntegrationContract();
  console.log("PASS advertising analytics contract: aggregate impressions/clicks, CTR reporting, tracked redirects, privacy-minimized schema, fail-closed integration.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
