function normalizeAdvertisingOrderId(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAnalyticsWindowDays(value, fallback = 30) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(90, parsed));
}

async function recordAdvertisingImpressions(pool, orderIds = []) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("Advertising analytics requires a database pool.");
  }

  const ids = [...new Set(
    (Array.isArray(orderIds) ? orderIds : [])
      .map(normalizeAdvertisingOrderId)
      .filter(Boolean)
  )];

  if (!ids.length) return 0;

  const result = await pool.query(
    `INSERT INTO advertising_metrics_daily (
       order_id, event_date, impressions, clicks, updated_at
     )
     SELECT ids.id, CURRENT_DATE, 1, 0, NOW()
     FROM unnest($1::bigint[]) AS ids(id)
     ON CONFLICT (order_id, event_date)
     DO UPDATE SET
       impressions = advertising_metrics_daily.impressions + 1,
       updated_at = NOW()`,
    [ids]
  );

  return Number(result.rowCount || ids.length);
}

async function recordAdvertisingClick(pool, orderId) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("Advertising analytics requires a database pool.");
  }

  const id = normalizeAdvertisingOrderId(orderId);
  if (!id) return false;

  const result = await pool.query(
    `INSERT INTO advertising_metrics_daily (
       order_id, event_date, impressions, clicks, updated_at
     )
     SELECT id, CURRENT_DATE, 0, 1, NOW()
     FROM advertising_orders
     WHERE id = $1
       AND payment_status = 'paid'
       AND review_status = 'approved'
       AND starts_at IS NOT NULL
       AND ends_at IS NOT NULL
       AND starts_at <= NOW()
       AND ends_at > NOW()
     ON CONFLICT (order_id, event_date)
     DO UPDATE SET
       clicks = advertising_metrics_daily.clicks + 1,
       updated_at = NOW()
     RETURNING order_id`,
    [id]
  );

  return Boolean(result.rows?.[0]?.order_id);
}

async function loadAdvertisingMetrics(pool, { days = 30 } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("Advertising analytics requires a database pool.");
  }

  const windowDays = normalizeAnalyticsWindowDays(days, 30);
  const result = await pool.query(
    `SELECT
       ao.id,
       ao.business_name,
       ao.package_code,
       ao.package_name,
       ao.featured,
       ao.payment_status,
       ao.review_status,
       ao.starts_at,
       ao.ends_at,
       ao.created_at,
       COALESCE(SUM(m.impressions), 0)::bigint AS impressions,
       COALESCE(SUM(m.clicks), 0)::bigint AS clicks
     FROM advertising_orders ao
     LEFT JOIN advertising_metrics_daily m
       ON m.order_id = ao.id
      AND m.event_date >= CURRENT_DATE - ($1::integer - 1)
     GROUP BY
       ao.id,
       ao.business_name,
       ao.package_code,
       ao.package_name,
       ao.featured,
       ao.payment_status,
       ao.review_status,
       ao.starts_at,
       ao.ends_at,
       ao.created_at
     ORDER BY COALESCE(SUM(m.impressions), 0) DESC, ao.created_at DESC
     LIMIT 500`,
    [windowDays]
  );

  const orders = result.rows.map((row) => {
    const impressions = Math.max(0, Number(row.impressions || 0));
    const clicks = Math.max(0, Number(row.clicks || 0));
    return {
      id: String(row.id),
      businessName: row.business_name,
      packageCode: row.package_code,
      packageName: row.package_name,
      featured: Boolean(row.featured),
      paymentStatus: row.payment_status,
      reviewStatus: row.review_status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      impressions,
      clicks,
      clickThroughRate: impressions > 0 ? clicks / impressions : 0
    };
  });

  const totals = orders.reduce(
    (summary, order) => {
      summary.impressions += order.impressions;
      summary.clicks += order.clicks;
      return summary;
    },
    { impressions: 0, clicks: 0 }
  );

  return {
    windowDays,
    totals: {
      ...totals,
      clickThroughRate: totals.impressions > 0 ? totals.clicks / totals.impressions : 0
    },
    orders
  };
}

module.exports = {
  normalizeAdvertisingOrderId,
  normalizeAnalyticsWindowDays,
  recordAdvertisingImpressions,
  recordAdvertisingClick,
  loadAdvertisingMetrics
};
