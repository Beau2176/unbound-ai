const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const serverPath = path.join(appRoot, "server.js");
const indexPath = path.join(appRoot, "index.html");
const adminPath = path.join(appRoot, "admin.html");
const securityPath = path.join(appRoot, "scripts", "security-contract.js");
const packagePath = path.join(appRoot, "package.json");

function replaceOnce(text, needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0) throw new Error(`v0.49 migration anchor missing: ${label}`);
  const second = text.indexOf(needle, first + needle.length);
  if (second >= 0) throw new Error(`v0.49 migration anchor is not unique: ${label}`);
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

let server = fs.readFileSync(serverPath, "utf8");

server = replaceOnce(
  server,
  'const {\n  normalizeAgeVerificationStatus,',
  'const {\n  advertisingPackages,\n  getAdvertisingPackage,\n  normalizeAdvertisingCreative\n} = require("./advertising/catalog");\nconst {\n  getAdvertisingPaymentStatus,\n  startAdvertisingCheckout,\n  processAdvertisingWebhook\n} = require("./advertising/gateway");\nconst {\n  normalizeAgeVerificationStatus,',
  "advertising imports"
);

server = replaceOnce(
  server,
  'const BILLING_WEBHOOK_PATH = "/api/webhooks/billing";\nconst RAW_WEBHOOK_PATHS = new Set([AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH]);',
  'const BILLING_WEBHOOK_PATH = "/api/webhooks/billing";\nconst ADVERTISING_WEBHOOK_PATH = "/api/webhooks/advertising";\nconst RAW_WEBHOOK_PATHS = new Set([\n  AGE_VERIFICATION_WEBHOOK_PATH,\n  BILLING_WEBHOOK_PATH,\n  ADVERTISING_WEBHOOK_PATH\n]);',
  "advertising webhook constants"
);

server = replaceOnce(
  server,
  'exemptPaths: [AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH]',
  'exemptPaths: [AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH, ADVERTISING_WEBHOOK_PATH]',
  "same-origin webhook allowlist"
);

server = replaceOnce(
  server,
  'app.get("/privacy.html", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "privacy.html"));\n});\napp.get("/unbound-cosmic.png",',
  'app.get("/privacy.html", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "privacy.html"));\n});\napp.get("/advertisers.html", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "advertisers.html"));\n});\napp.get("/advertising-admin", requireDatabase, requireAdmin, (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "advertising-admin.html"));\n});\napp.get("/unbound-cosmic.png",',
  "advertiser routes"
);

const advertisingSchema = `    CREATE TABLE IF NOT EXISTS advertising_orders (
      id BIGSERIAL PRIMARY KEY,
      subject_hash TEXT NOT NULL UNIQUE,
      package_code TEXT NOT NULL,
      package_name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      currency TEXT NOT NULL CHECK (char_length(currency) = 3),
      duration_days SMALLINT NOT NULL CHECK (duration_days > 0),
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      business_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      website_url TEXT NOT NULL,
      headline TEXT NOT NULL,
      description TEXT NOT NULL,
      payment_provider TEXT,
      payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending','paid','failed','canceled','refunded')),
      review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending','approved','rejected')),
      reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      last_event_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS advertising_orders_public_idx
      ON advertising_orders(payment_status, review_status, featured DESC, ends_at);

    CREATE INDEX IF NOT EXISTS advertising_orders_admin_idx
      ON advertising_orders(review_status, payment_status, created_at DESC);

    CREATE TABLE IF NOT EXISTS advertising_payment_events (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      order_id BIGINT REFERENCES advertising_orders(id) ON DELETE SET NULL,
      event_type TEXT,
      payment_status TEXT,
      payload_sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      error_text TEXT,
      occurred_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      UNIQUE(provider, provider_event_id)
    );

    CREATE INDEX IF NOT EXISTS advertising_payment_events_received_idx
      ON advertising_payment_events(received_at DESC);

`;

server = replaceOnce(
  server,
  '    CREATE TABLE IF NOT EXISTS account_age_verification (',
  advertisingSchema + '    CREATE TABLE IF NOT EXISTS account_age_verification (',
  "advertising schema"
);

const advertisingRoutes = `/* -------------------------- ADVERTISING --------------------------- */

function advertisingReturnUrl(req, result) {
  let origin = String(process.env.PUBLIC_APP_ORIGIN || "").trim();
  try {
    if (origin) {
      const parsed = new URL(origin);
      origin = parsed.protocol === "https:" ? parsed.origin : "";
    }
  } catch (_) {
    origin = "";
  }
  if (!origin) {
    const host = req.get("host");
    if (!host) return null;
    origin = \`\${IS_PRODUCTION ? "https" : req.protocol}://\${host}\`;
  }
  if (!origin.startsWith("https://")) return null;
  return \`\${origin}/advertisers.html?payment=\${encodeURIComponent(result)}\`;
}

app.get("/api/advertising/catalog", requireDatabase, async (req, res) => {
  try {
    const result = await pool.query(
      \`SELECT business_name, website_url, headline, description, featured, ends_at
       FROM advertising_orders
       WHERE payment_status = 'paid'
         AND review_status = 'approved'
         AND starts_at IS NOT NULL
         AND ends_at IS NOT NULL
         AND starts_at <= NOW()
         AND ends_at > NOW()
       ORDER BY featured DESC, starts_at DESC
       LIMIT 100\`
    );

    return res.json({
      packages: advertisingPackages(),
      payment: getAdvertisingPaymentStatus(),
      ads: result.rows.map((row) => ({
        businessName: row.business_name,
        websiteUrl: row.website_url,
        headline: row.headline,
        description: row.description,
        featured: Boolean(row.featured),
        endsAt: row.ends_at
      }))
    });
  } catch (error) {
    console.error("UNBOUND AI ADVERTISING CATALOG ERROR:", error);
    return res.status(500).json({ error: "Could not load advertising." });
  }
});

app.post("/api/advertising/orders", requireDatabase, registerRateLimit, async (req, res) => {
  const packageDefinition = getAdvertisingPackage(req.body?.packageCode);
  const creative = normalizeAdvertisingCreative(req.body);
  const payment = getAdvertisingPaymentStatus();

  if (!packageDefinition || !creative) {
    return res.status(400).json({
      error: "Choose a valid advertising package and complete all advertiser fields. HTTPS website URLs are required."
    });
  }
  if (!(payment.configured && payment.checkout && payment.webhooks)) {
    return res.status(503).json({
      error: "Advertising checkout is not connected yet. Payment processing must be configured before orders can be purchased."
    });
  }

  const subject = crypto.randomBytes(32).toString("hex");
  const subjectHash = crypto.createHash("sha256").update(subject).digest("hex");
  let orderId = null;

  try {
    const inserted = await pool.query(
      \`INSERT INTO advertising_orders (
         subject_hash, package_code, package_name, amount_cents, currency,
         duration_days, featured, business_name, contact_email, website_url,
         headline, description, payment_provider, payment_status, review_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending','pending')
       RETURNING id\`,
      [
        subjectHash,
        packageDefinition.code,
        packageDefinition.name,
        packageDefinition.amountCents,
        packageDefinition.currency,
        packageDefinition.durationDays,
        packageDefinition.featured,
        creative.businessName,
        creative.contactEmail,
        creative.websiteUrl,
        creative.headline,
        creative.description,
        payment.provider
      ]
    );
    orderId = inserted.rows[0].id;

    const checkout = await startAdvertisingCheckout({
      subject,
      email: creative.contactEmail,
      packageCode: packageDefinition.code,
      amountCents: packageDefinition.amountCents,
      currency: packageDefinition.currency,
      successUrl: advertisingReturnUrl(req, "success"),
      cancelUrl: advertisingReturnUrl(req, "canceled"),
      requestId: req.requestId
    });

    return res.status(201).json({
      orderId,
      checkoutUrl: checkout.checkoutUrl,
      expiresAt: checkout.expiresAt
    });
  } catch (error) {
    if (orderId) {
      await pool.query(
        \`UPDATE advertising_orders
         SET payment_status = 'failed', updated_at = NOW()
         WHERE id = $1 AND payment_status = 'pending'\`,
        [orderId]
      ).catch(() => {});
    }
    console.error("UNBOUND AI ADVERTISING CHECKOUT ERROR:", error);
    return res.status(error?.statusCode || 500).json({
      error: error?.publicMessage || "Could not start advertising checkout."
    });
  }
});

app.post(ADVERTISING_WEBHOOK_PATH, requireDatabase, async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");
  let event;

  try {
    event = await processAdvertisingWebhook({
      rawBody,
      headers: req.headers,
      requestId: req.requestId
    });
  } catch (error) {
    console.error("UNBOUND AI ADVERTISING WEBHOOK ERROR:", error?.message || error);
    return res.status(error?.statusCode || 400).json({
      error: error?.publicMessage || "Advertising payment webhook rejected."
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      \`INSERT INTO advertising_payment_events (
         provider, provider_event_id, event_type, payment_status,
         payload_sha256, status, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,'received',$6)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id\`,
      [
        event.provider,
        event.providerEventId,
        event.eventType,
        event.paymentStatus,
        payloadSha256,
        event.occurredAt
      ]
    );

    if (!inserted.rows[0]) {
      await client.query("ROLLBACK");
      return res.json({ ok: true, duplicate: true });
    }

    const subjectHash = crypto.createHash("sha256").update(event.subject).digest("hex");
    const orderResult = await client.query(
      \`SELECT id, last_event_at
       FROM advertising_orders
       WHERE subject_hash = $1
       FOR UPDATE\`,
      [subjectHash]
    );
    const order = orderResult.rows[0];

    if (!order) {
      await client.query(
        \`UPDATE advertising_payment_events
         SET status = 'ignored', error_text = 'unknown-order', processed_at = NOW()
         WHERE id = $1\`,
        [inserted.rows[0].id]
      );
      await client.query("COMMIT");
      return res.status(202).json({ ok: true, ignored: true });
    }

    if (order.last_event_at && new Date(event.occurredAt) <= new Date(order.last_event_at)) {
      await client.query(
        \`UPDATE advertising_payment_events
         SET order_id = $1, status = 'ignored', error_text = 'ignored-stale-event', processed_at = NOW()
         WHERE id = $2\`,
        [order.id, inserted.rows[0].id]
      );
      await client.query("COMMIT");
      return res.json({ ok: true, ignored: true });
    }

    await client.query(
      \`UPDATE advertising_orders
       SET payment_provider = $1,
           payment_status = $2,
           last_event_at = $3,
           updated_at = NOW()
       WHERE id = $4\`,
      [event.provider, event.paymentStatus, event.occurredAt, order.id]
    );
    await client.query(
      \`UPDATE advertising_payment_events
       SET order_id = $1, status = 'processed', processed_at = NOW()
       WHERE id = $2\`,
      [order.id, inserted.rows[0].id]
    );
    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("UNBOUND AI ADVERTISING WEBHOOK DATABASE ERROR:", error);
    return res.status(500).json({ error: "Could not process advertising payment event." });
  } finally {
    client.release();
  }
});

app.get("/api/admin/advertising/orders", requireDatabase, requireAdmin, async (req, res) => {
  const reviewStatus = String(req.query.reviewStatus || "").trim().toLowerCase();
  const allowedReview = new Set(["pending", "approved", "rejected"]);
  const values = [];
  let where = "";
  if (allowedReview.has(reviewStatus)) {
    values.push(reviewStatus);
    where = "WHERE review_status = $1";
  }

  try {
    const result = await pool.query(
      \`SELECT id, package_code, package_name, amount_cents, currency, duration_days,
              featured, business_name, contact_email, website_url, headline, description,
              payment_status, review_status, reviewed_at, starts_at, ends_at, created_at
       FROM advertising_orders
       \${where}
       ORDER BY created_at DESC
       LIMIT 500\`,
      values
    );

    return res.json({
      orders: result.rows.map((row) => ({
        id: row.id,
        packageCode: row.package_code,
        packageName: row.package_name,
        amountCents: row.amount_cents,
        currency: row.currency,
        durationDays: row.duration_days,
        featured: Boolean(row.featured),
        businessName: row.business_name,
        contactEmail: row.contact_email,
        websiteUrl: row.website_url,
        headline: row.headline,
        description: row.description,
        paymentStatus: row.payment_status,
        reviewStatus: row.review_status,
        reviewedAt: row.reviewed_at,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    console.error("UNBOUND AI ADVERTISING ADMIN LIST ERROR:", error);
    return res.status(500).json({ error: "Could not load advertiser orders." });
  }
});

app.post("/api/admin/advertising/orders/:id/review", requireDatabase, requireAdmin, async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);
  const action = String(req.body?.action || "").trim().toLowerCase();
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "Advertising review request is invalid." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      \`SELECT id, payment_status, review_status, duration_days, starts_at, ends_at
       FROM advertising_orders
       WHERE id = $1
       FOR UPDATE\`,
      [orderId]
    );
    const order = result.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Advertiser order was not found." });
    }

    if (action === "approve" && order.payment_status !== "paid") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only paid advertiser orders can be approved." });
    }

    if (action === "approve") {
      await client.query(
        \`UPDATE advertising_orders
         SET review_status = 'approved',
             reviewed_by_user_id = $1,
             reviewed_at = NOW(),
             starts_at = COALESCE(starts_at, NOW()),
             ends_at = COALESCE(ends_at, NOW() + (duration_days * INTERVAL '1 day')),
             updated_at = NOW()
         WHERE id = $2\`,
        [req.user.id, orderId]
      );
    } else {
      await client.query(
        \`UPDATE advertising_orders
         SET review_status = 'rejected',
             reviewed_by_user_id = $1,
             reviewed_at = NOW(),
             starts_at = NULL,
             ends_at = NULL,
             updated_at = NOW()
         WHERE id = $2\`,
        [req.user.id, orderId]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true, reviewStatus: action === "approve" ? "approved" : "rejected" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("UNBOUND AI ADVERTISING REVIEW ERROR:", error);
    return res.status(500).json({ error: "Could not review advertiser order." });
  } finally {
    client.release();
  }
});

`;

server = replaceOnce(
  server,
  '/* ----------------------------- ADMIN API ----------------------------- */',
  advertisingRoutes + '/* ----------------------------- ADMIN API ----------------------------- */',
  "advertising API routes"
);

fs.writeFileSync(serverPath, server);

let indexHtml = fs.readFileSync(indexPath, "utf8");
indexHtml = replaceOnce(
  indexHtml,
  '    .account-button.danger:hover {\n      border-color: rgba(255, 118, 118, 0.62);',
  '    .advertiser-link {\n      display: inline-flex;\n      align-items: center;\n      text-decoration: none;\n    }\n\n    .account-button.danger:hover {\n      border-color: rgba(255, 118, 118, 0.62);',
  "advertiser link style"
);
indexHtml = replaceOnce(
  indexHtml,
  '    <div class="topbar-right">\n      <div id="serviceStatus"',
  '    <div class="topbar-right">\n      <a class="account-button advertiser-link" href="/advertisers.html">ADVERTISE</a>\n      <div id="serviceStatus"',
  "main navigation advertiser link"
);
fs.writeFileSync(indexPath, indexHtml);

let adminHtml = fs.readFileSync(adminPath, "utf8");
adminHtml = replaceOnce(
  adminHtml,
  '      <span class="pill">OWNER CONTROL</span>\n      <a class="link-btn" href="/">Back to Chat</a>',
  '      <span class="pill">OWNER CONTROL</span>\n      <a class="link-btn" href="/advertising-admin">Advertising</a>\n      <a class="link-btn" href="/">Back to Chat</a>',
  "admin advertiser link"
);
fs.writeFileSync(adminPath, adminHtml);

let security = fs.readFileSync(securityPath, "utf8");
security = replaceOnce(
  security,
  'requireText(server, \'app.get("/privacy.html"\', "explicit Privacy route");\nrequireText(server, \'app.get("/unbound-cosmic.png"\', "explicit branding route");',
  'requireText(server, \'app.get("/privacy.html"\', "explicit Privacy route");\nrequireText(server, \'app.get("/advertisers.html"\', "explicit advertiser page route");\nrequireText(server, \'app.get("/advertising-admin"\', "protected advertiser admin route");\nrequireText(server, \'app.get("/unbound-cosmic.png"\', "explicit branding route");',
  "security advertiser page routes"
);
security = replaceOnce(
  security,
  'const billingWebhookPath = \'const BILLING_WEBHOOK_PATH = "/api/webhooks/billing";\';\nrequireText(server, ageWebhookPath, "exact age-verification webhook path constant");\nrequireText(server, billingWebhookPath, "exact billing webhook path constant");',
  'const billingWebhookPath = \'const BILLING_WEBHOOK_PATH = "/api/webhooks/billing";\';\nconst advertisingWebhookPath = \'const ADVERTISING_WEBHOOK_PATH = "/api/webhooks/advertising";\';\nrequireText(server, ageWebhookPath, "exact age-verification webhook path constant");\nrequireText(server, billingWebhookPath, "exact billing webhook path constant");\nrequireText(server, advertisingWebhookPath, "exact advertising webhook path constant");',
  "security advertising webhook constant"
);
security = replaceOnce(
  security,
  '"exemptPaths: [AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH]",',
  '"exemptPaths: [AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH, ADVERTISING_WEBHOOK_PATH]",',
  "security same-origin allowlist"
);
security = replaceOnce(
  security,
  '"const RAW_WEBHOOK_PATHS = new Set([AGE_VERIFICATION_WEBHOOK_PATH, BILLING_WEBHOOK_PATH]);",',
  '"const RAW_WEBHOOK_PATHS = new Set([\\n  AGE_VERIFICATION_WEBHOOK_PATH,\\n  BILLING_WEBHOOK_PATH,\\n  ADVERTISING_WEBHOOK_PATH\\n]);",',
  "security raw webhook allowlist"
);
fs.writeFileSync(securityPath, security);

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (!pkg.scripts?.["regression-check"]?.includes("advertising-contract.js")) {
  pkg.scripts["regression-check"] += " && node scripts/advertising-contract.js";
}
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");

console.log("Applied v0.49 advertiser marketplace migration.");
