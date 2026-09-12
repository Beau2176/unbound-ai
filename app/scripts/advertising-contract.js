const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  advertisingPackages,
  getAdvertisingPackage,
  normalizeAdvertisingCreative
} = require("../advertising/catalog");
const {
  registerAdvertisingPaymentAdapter,
  getAdvertisingPaymentStatus,
  startAdvertisingCheckout,
  processAdvertisingWebhook
} = require("../advertising/gateway");

const appRoot = path.resolve(__dirname, "..");

function testCatalog() {
  const packages = advertisingPackages({});
  assert.equal(packages.length, 3);
  assert.deepEqual(packages.map((item) => item.code), ["starter", "monthly", "featured"]);
  assert.equal(packages.every((item) => item.amountCents > 0), true);
  assert.equal(packages.every((item) => item.currency === "USD"), true);
  assert.equal(getAdvertisingPackage("featured", {}).featured, true);

  const custom = advertisingPackages({
    ADVERTISING_CURRENCY: "usd",
    ADVERTISING_STARTER_CENTS: "1900",
    ADVERTISING_MONTHLY_CENTS: "5900",
    ADVERTISING_FEATURED_CENTS: "11900"
  });
  assert.equal(custom[0].amountCents, 1900);
  assert.equal(custom[2].amountCents, 11900);
}

function testCreativeValidation() {
  const valid = normalizeAdvertisingCreative({
    businessName: "Example Company",
    contactEmail: "ads@example.com",
    websiteUrl: "https://example.com/product",
    headline: "Reach more customers",
    description: "A normal advertising description."
  });
  assert.ok(valid);
  assert.equal(valid.contactEmail, "ads@example.com");
  assert.equal(valid.websiteUrl.startsWith("https://"), true);

  assert.equal(
    normalizeAdvertisingCreative({
      businessName: "Example Company",
      contactEmail: "ads@example.com",
      websiteUrl: "http://example.com",
      headline: "Unsafe URL",
      description: "This must be rejected."
    }),
    null
  );
}

async function testGateway() {
  let parseCalls = 0;
  registerAdvertisingPaymentAdapter("regression-ads", {
    capabilities: { checkout: true, webhooks: true },
    isConfigured: () => true,
    async startCheckout(input) {
      assert.equal(input.productType, "advertising");
      assert.equal(input.productCode, "starter");
      assert.equal(input.amountCents, 2500);
      return { checkoutUrl: "https://payments.example/checkout/ad_123" };
    },
    async verifyWebhook({ headers }) {
      return headers["x-test-signature"] === "valid";
    },
    async parseWebhook() {
      parseCalls += 1;
      return {
        eventId: "evt_ad_123",
        eventType: "payment.completed",
        subject: "opaque-advertising-subject",
        paymentStatus: "paid",
        occurredAt: "2026-09-12T18:00:00Z"
      };
    }
  });

  const env = { ADVERTISING_PAYMENT_PROVIDER: "regression-ads" };
  const status = getAdvertisingPaymentStatus(env);
  assert.equal(status.configured, true);
  assert.equal(status.checkout, true);
  assert.equal(status.webhooks, true);

  const checkout = await startAdvertisingCheckout({
    subject: "opaque-advertising-subject",
    email: "ads@example.com",
    packageCode: "starter",
    amountCents: 2500,
    currency: "USD",
    successUrl: "https://unbound.example/advertisers.html?payment=success",
    cancelUrl: "https://unbound.example/advertisers.html?payment=canceled",
    env
  });
  assert.equal(checkout.checkoutUrl, "https://payments.example/checkout/ad_123");

  await assert.rejects(
    () => processAdvertisingWebhook({
      rawBody: Buffer.from("{}"),
      headers: { "x-test-signature": "invalid" },
      env
    }),
    (error) => error.code === "ADVERTISING_WEBHOOK_SIGNATURE_INVALID"
  );
  assert.equal(parseCalls, 0, "Advertising webhook must verify signature before parsing payload.");

  const event = await processAdvertisingWebhook({
    rawBody: Buffer.from("{}"),
    headers: { "x-test-signature": "valid" },
    env
  });
  assert.equal(parseCalls, 1);
  assert.equal(event.paymentStatus, "paid");
  assert.equal(event.subject, "opaque-advertising-subject");
}

function sourceContract() {
  const server = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const index = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  const admin = fs.readFileSync(path.join(appRoot, "admin.html"), "utf8");
  const advertisers = fs.readFileSync(path.join(appRoot, "advertisers.html"), "utf8");
  const advertisingAdmin = fs.readFileSync(path.join(appRoot, "advertising-admin.html"), "utf8");

  for (const needle of [
    'app.get("/advertisers.html"',
    'app.get("/advertising-admin"',
    'app.get("/api/advertising/catalog"',
    'app.post("/api/advertising/orders"',
    'app.post(ADVERTISING_WEBHOOK_PATH',
    'app.get("/api/admin/advertising/orders"',
    'app.post("/api/admin/advertising/orders/:id/review"',
    "CREATE TABLE IF NOT EXISTS advertising_orders",
    "CREATE TABLE IF NOT EXISTS advertising_payment_events",
    "payment_status = 'paid'",
    "review_status = 'approved'",
    "Only paid advertiser orders can be approved.",
    "ON CONFLICT (provider, provider_event_id) DO NOTHING",
    "ignored-stale-event"
  ]) {
    assert.ok(server.includes(needle), `Advertising server contract missing: ${needle}`);
  }

  assert.ok(index.includes('href="/advertisers.html"'), "Main UNBOUND page must link to advertiser page.");
  assert.ok(admin.includes('href="/advertising-admin"'), "Admin dashboard must link to advertiser review page.");
  assert.ok(advertisers.includes('rel = "sponsored noopener noreferrer"'), "Public advertiser links must be marked sponsored.");
  assert.ok(advertisers.includes("title.textContent = ad.headline"), "Ad headline must render as text, not HTML.");
  assert.ok(advertisers.includes("body.textContent = ad.description"), "Ad description must render as text, not HTML.");
  assert.ok(advertisers.includes("UNBOUND never inserts paid advertising into AI answers"), "Advertiser page must state ads are separate from AI answers.");
  assert.ok(advertisingAdmin.includes("Only paid and approved orders become public advertiser placements."));
  assert.ok(!server.includes("INSERT INTO advertising_payment_events (raw"), "Raw advertising webhook bodies must not be persisted.");
}

(async () => {
  testCatalog();
  testCreativeValidation();
  await testGateway();
  sourceContract();
  console.log("PASS advertising contract: packages, HTTPS creative, payment verification, paid+approved publication, admin review, ad separation.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
