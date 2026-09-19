"use strict";

const crypto = require("crypto");

const GROWTH_EVENT_NAMES = Object.freeze([
  "landing_view",
  "account_registered",
  "checkout_started",
  "referral_link_viewed",
  "referral_signup",
  "subscription_activated",
  "subscription_churned"
]);

function cleanText(value, maxLength = 120) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maxLength) || null;
}

function cleanReferralCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{6,24}$/.test(code) ? code : null;
}

function cleanPartnerCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code) ? code : null;
}

function cleanLandingPath(value) {
  const text = cleanText(value, 240);
  if (!text || !text.startsWith("/") || text.startsWith("//")) return null;
  return text;
}

function normalizeAcquisition(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    source: cleanText(input.source, 80),
    medium: cleanText(input.medium, 80),
    campaign: cleanText(input.campaign, 120),
    content: cleanText(input.content, 120),
    referralCode: cleanReferralCode(input.referralCode || input.ref),
    partnerCode: cleanPartnerCode(input.partnerCode || input.partner),
    landingPath: cleanLandingPath(input.landingPath)
  };
}

function referralCodeCandidate() {
  return crypto.randomBytes(6).toString("base64url").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
}

function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, raw] of Object.entries(value).slice(0, 12)) {
    const cleanKey = String(key || "").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40);
    if (!cleanKey) continue;
    if (typeof raw === "boolean" || typeof raw === "number") {
      output[cleanKey] = raw;
      continue;
    }
    if (typeof raw !== "string") continue;
    const text = cleanText(raw, 160);
    if (text !== null) output[cleanKey] = text;
  }
  return output;
}

async function initializeGrowthSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_referral_codes (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS growth_partner_codes (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT growth_partner_codes_code_check CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}
      referrer_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      referral_code TEXT,
      partner_code TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      content TEXT,
      landing_path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE growth_attributions
      ADD COLUMN IF NOT EXISTS partner_code TEXT;

    CREATE INDEX IF NOT EXISTS growth_attributions_partner_idx
      ON growth_attributions(partner_code, created_at DESC);

    CREATE INDEX IF NOT EXISTS growth_attributions_referrer_idx
      ON growth_attributions(referrer_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS growth_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      event_name TEXT NOT NULL,
      plan_tier TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      referral_code TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT growth_events_name_check CHECK (
        event_name IN ('landing_view','account_registered','checkout_started','referral_link_viewed','referral_signup','subscription_activated','subscription_churned')
      )
    );

    ALTER TABLE growth_events
      DROP CONSTRAINT IF EXISTS growth_events_name_check;
    ALTER TABLE growth_events
      ADD CONSTRAINT growth_events_name_check CHECK (
        event_name IN ('landing_view','account_registered','checkout_started','referral_link_viewed','referral_signup','subscription_activated','subscription_churned')
      );

    CREATE INDEX IF NOT EXISTS growth_events_name_created_idx
      ON growth_events(event_name, created_at DESC);

    CREATE INDEX IF NOT EXISTS growth_events_user_created_idx
      ON growth_events(user_id, created_at DESC);
  `);
}

async function ensureReferralCode(pool, userId) {
  const existing = await pool.query(
    "SELECT code FROM growth_referral_codes WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (existing.rows[0]?.code) return existing.rows[0].code;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = referralCodeCandidate();
    try {
      const inserted = await pool.query(
        `INSERT INTO growth_referral_codes (user_id, code)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET code = growth_referral_codes.code
         RETURNING code`,
        [userId, code]
      );
      if (inserted.rows[0]?.code) return inserted.rows[0].code;
    } catch (error) {
      if (error?.code !== "23505") throw error;
    }
  }

  const error = new Error("Could not create a referral code.");
  error.code = "GROWTH_REFERRAL_CODE_UNAVAILABLE";
  throw error;
}

async function recordGrowthEvent(pool, {
  userId = null,
  eventName,
  planTier = null,
  acquisition = null,
  referralCode = null,
  metadata = {}
} = {}) {
  if (!GROWTH_EVENT_NAMES.includes(eventName)) return false;
  const normalized = normalizeAcquisition(acquisition);
  await pool.query(
    `INSERT INTO growth_events (
       user_id, event_name, plan_tier, source, medium, campaign, referral_code, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      userId,
      eventName,
      cleanText(planTier, 30),
      normalized.source,
      normalized.medium,
      normalized.campaign,
      cleanReferralCode(referralCode) || normalized.referralCode,
      JSON.stringify(safeMetadata(metadata))
    ]
  );
  return true;
}

async function captureRegistrationGrowth({ pool, userId, acquisition } = {}) {
  const normalized = normalizeAcquisition(acquisition);
  const ownCode = await ensureReferralCode(pool, userId);
  let referrerUserId = null;
  let partnerCode = null;

  if (normalized.referralCode && normalized.referralCode !== ownCode) {
    const referrer = await pool.query(
      "SELECT user_id FROM growth_referral_codes WHERE code = $1 LIMIT 1",
      [normalized.referralCode]
    );
    const candidate = referrer.rows[0]?.user_id || null;
    if (candidate && String(candidate) !== String(userId)) {
      referrerUserId = candidate;
    }
  }

  if (normalized.partnerCode) {
    const partner = await pool.query(
      "SELECT code FROM growth_partner_codes WHERE code = $1 AND active = TRUE LIMIT 1",
      [normalized.partnerCode]
    );
    partnerCode = partner.rows[0]?.code || null;
  }

  await pool.query(
    `INSERT INTO growth_attributions (
       user_id, referrer_user_id, referral_code, partner_code, source, medium, campaign, content, landing_path
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id) DO NOTHING`,
    [
      userId,
      referrerUserId,
      normalized.referralCode,
      partnerCode,
      normalized.source,
      normalized.medium,
      normalized.campaign,
      normalized.content,
      normalized.landingPath
    ]
  );

  await recordGrowthEvent(pool, {
    userId,
    eventName: "account_registered",
    acquisition: normalized,
    referralCode: normalized.referralCode,
    metadata: { referred: Boolean(referrerUserId), partnerAttributed: Boolean(partnerCode) }
  });

  if (referrerUserId) {
    await recordGrowthEvent(pool, {
      userId: referrerUserId,
      eventName: "referral_signup",
      referralCode: normalized.referralCode,
      metadata: { converted: true }
    });
  }

  return {
    referralCode: ownCode,
    referred: Boolean(referrerUserId),
    partnerAttributed: Boolean(partnerCode)
  };
}

async function createGrowthPartnerCode(pool, { code, label } = {}) {
  const normalizedCode = cleanPartnerCode(code);
  const normalizedLabel = cleanText(label, 120);
  if (!normalizedCode || !normalizedLabel) {
    const error = new Error("Partner code and label are invalid.");
    error.code = "GROWTH_PARTNER_INPUT_INVALID";
    throw error;
  }

  try {
    const result = await pool.query(
      `INSERT INTO growth_partner_codes (code, label, active, created_at, updated_at)
       VALUES ($1, $2, TRUE, NOW(), NOW())
       RETURNING code, label, active, created_at, updated_at`,
      [normalizedCode, normalizedLabel]
    );
    return result.rows[0];
  } catch (error) {
    if (error?.code === "23505") {
      const duplicate = new Error("That partner code already exists.");
      duplicate.code = "GROWTH_PARTNER_CODE_EXISTS";
      throw duplicate;
    }
    throw error;
  }
}

async function setGrowthPartnerActive(pool, code, active) {
  const normalizedCode = cleanPartnerCode(code);
  if (!normalizedCode || typeof active !== "boolean") {
    const error = new Error("Partner code update is invalid.");
    error.code = "GROWTH_PARTNER_INPUT_INVALID";
    throw error;
  }
  const result = await pool.query(
    `UPDATE growth_partner_codes
     SET active = $2, updated_at = NOW()
     WHERE code = $1
     RETURNING code, label, active, created_at, updated_at`,
    [normalizedCode, active]
  );
  return result.rows[0] || null;
}

async function listGrowthPartnerCodes(pool) {
  const result = await pool.query(
    `SELECT p.code, p.label, p.active, p.created_at, p.updated_at,
            COUNT(a.user_id)::int AS attributed_registrations
     FROM growth_partner_codes p
     LEFT JOIN growth_attributions a ON a.partner_code = p.code
     GROUP BY p.id, p.code, p.label, p.active, p.created_at, p.updated_at
     ORDER BY p.created_at DESC, p.code ASC
     LIMIT 250`
  );
  return result.rows.map((row) => ({
    code: String(row.code),
    label: String(row.label),
    active: Boolean(row.active),
    attributedRegistrations: Number(row.attributed_registrations || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

async function getGrowthAdminSummary(pool, days = 30) {
  const parsedDays = Number.parseInt(String(days || "30"), 10);
  const windowDays = Math.min(365, Math.max(1, Number.isFinite(parsedDays) ? parsedDays : 30));

  const [
    registrationsResult,
    eventsResult,
    activePaidResult,
    planMixResult,
    sourcesResult,
    campaignsResult,
    referralResult,
    landingPagesResult,
    partnerRegistrationsResult
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM users
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
      [windowDays]
    ),
    pool.query(
      `SELECT event_name, COUNT(*)::int AS count
       FROM growth_events
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY event_name`,
      [windowDays]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM account_subscriptions
       WHERE status IN ('active', 'trialing')
         AND plan_tier IN ('premium', 'ultra', 'max')`
    ),
    pool.query(
      `SELECT plan_tier, COUNT(*)::int AS count
       FROM account_subscriptions
       WHERE status IN ('active', 'trialing')
         AND plan_tier IN ('premium', 'ultra', 'max')
       GROUP BY plan_tier
       ORDER BY plan_tier`
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(source, ''), '(direct / unknown)') AS label,
              COUNT(*)::int AS registrations
       FROM growth_attributions
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY COALESCE(NULLIF(source, ''), '(direct / unknown)')
       ORDER BY registrations DESC, label ASC
       LIMIT 12`,
      [windowDays]
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(campaign, ''), '(none)') AS label,
              COUNT(*)::int AS registrations
       FROM growth_attributions
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY COALESCE(NULLIF(campaign, ''), '(none)')
       ORDER BY registrations DESC, label ASC
       LIMIT 12`,
      [windowDays]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM growth_attributions
       WHERE referrer_user_id IS NOT NULL
         AND created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
      [windowDays]
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(metadata->>'feature', ''), '(unknown)') AS label,
              COUNT(*)::int AS views
       FROM growth_events
       WHERE event_name = 'landing_view'
         AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY COALESCE(NULLIF(metadata->>'feature', ''), '(unknown)')
       ORDER BY views DESC, label ASC
       LIMIT 20`,
      [windowDays]
    ),
    pool.query(
      `SELECT partner_code AS label, COUNT(*)::int AS registrations
       FROM growth_attributions
       WHERE partner_code IS NOT NULL
         AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY partner_code
       ORDER BY registrations DESC, partner_code ASC
       LIMIT 20`,
      [windowDays]
    )
  ]);

  const eventCounts = Object.fromEntries(
    eventsResult.rows.map((row) => [String(row.event_name), Number(row.count || 0)])
  );
  const landingViews = Number(eventCounts.landing_view || 0);
  const registrations = Number(registrationsResult.rows[0]?.count || 0);
  const checkoutStarts = Number(eventCounts.checkout_started || 0);
  const paidActivations = Number(eventCounts.subscription_activated || 0);
  const churned = Number(eventCounts.subscription_churned || 0);
  const referredRegistrations = Number(referralResult.rows[0]?.count || 0);

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    funnel: {
      landingViews,
      registrations,
      checkoutStarts,
      paidActivations,
      churned,
      referredRegistrations,
      landingViewToRegistrationRatio: landingViews > 0 ? registrations / landingViews : 0,
      registrationToCheckoutRate: registrations > 0 ? checkoutStarts / registrations : 0,
      registrationToPaidRate: registrations > 0 ? paidActivations / registrations : 0,
      referralShare: registrations > 0 ? referredRegistrations / registrations : 0
    },
    activePaidSubscribers: Number(activePaidResult.rows[0]?.count || 0),
    activePlanMix: planMixResult.rows.map((row) => ({
      planTier: String(row.plan_tier || ""),
      count: Number(row.count || 0)
    })),
    registrationsBySource: sourcesResult.rows.map((row) => ({
      label: String(row.label || "(unknown)"),
      registrations: Number(row.registrations || 0)
    })),
    registrationsByCampaign: campaignsResult.rows.map((row) => ({
      label: String(row.label || "(none)"),
      registrations: Number(row.registrations || 0)
    })),
    landingViewsByFeature: landingPagesResult.rows.map((row) => ({
      label: String(row.label || "(unknown)"),
      views: Number(row.views || 0)
    })),
    registrationsByPartner: partnerRegistrationsResult.rows.map((row) => ({
      label: String(row.label || "(unknown)"),
      registrations: Number(row.registrations || 0)
    }))
  };
}

async function getReferralSummary(pool, userId, publicOrigin = "") {
  const code = await ensureReferralCode(pool, userId);
  const countResult = await pool.query(
    "SELECT COUNT(*)::int AS referred_accounts FROM growth_attributions WHERE referrer_user_id = $1",
    [userId]
  );
  const origin = String(publicOrigin || "").trim().replace(/\/+$/, "");
  const referralLink = origin ? `${origin}/?ref=${encodeURIComponent(code)}` : `/?ref=${encodeURIComponent(code)}`;

  return {
    code,
    referralLink,
    referredAccounts: Number(countResult.rows[0]?.referred_accounts || 0)
  };
}

module.exports = {
  GROWTH_EVENT_NAMES,
  cleanText,
  cleanReferralCode,
  cleanPartnerCode,
  cleanLandingPath,
  normalizeAcquisition,
  safeMetadata,
  initializeGrowthSchema,
  ensureReferralCode,
  recordGrowthEvent,
  captureRegistrationGrowth,
  getReferralSummary,
  createGrowthPartnerCode,
  setGrowthPartnerActive,
  listGrowthPartnerCodes,
  getGrowthAdminSummary
};
),
      CONSTRAINT growth_partner_codes_label_check CHECK (char_length(label) BETWEEN 1 AND 120)
    );

    CREATE TABLE IF NOT EXISTS growth_attributions (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      referrer_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      referral_code TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      content TEXT,
      landing_path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS growth_attributions_referrer_idx
      ON growth_attributions(referrer_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS growth_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      event_name TEXT NOT NULL,
      plan_tier TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      referral_code TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT growth_events_name_check CHECK (
        event_name IN ('landing_view','account_registered','checkout_started','referral_link_viewed','referral_signup','subscription_activated','subscription_churned')
      )
    );

    ALTER TABLE growth_events
      DROP CONSTRAINT IF EXISTS growth_events_name_check;
    ALTER TABLE growth_events
      ADD CONSTRAINT growth_events_name_check CHECK (
        event_name IN ('landing_view','account_registered','checkout_started','referral_link_viewed','referral_signup','subscription_activated','subscription_churned')
      );

    CREATE INDEX IF NOT EXISTS growth_events_name_created_idx
      ON growth_events(event_name, created_at DESC);

    CREATE INDEX IF NOT EXISTS growth_events_user_created_idx
      ON growth_events(user_id, created_at DESC);
  `);
}

async function ensureReferralCode(pool, userId) {
  const existing = await pool.query(
    "SELECT code FROM growth_referral_codes WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (existing.rows[0]?.code) return existing.rows[0].code;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = referralCodeCandidate();
    try {
      const inserted = await pool.query(
        `INSERT INTO growth_referral_codes (user_id, code)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET code = growth_referral_codes.code
         RETURNING code`,
        [userId, code]
      );
      if (inserted.rows[0]?.code) return inserted.rows[0].code;
    } catch (error) {
      if (error?.code !== "23505") throw error;
    }
  }

  const error = new Error("Could not create a referral code.");
  error.code = "GROWTH_REFERRAL_CODE_UNAVAILABLE";
  throw error;
}

async function recordGrowthEvent(pool, {
  userId = null,
  eventName,
  planTier = null,
  acquisition = null,
  referralCode = null,
  metadata = {}
} = {}) {
  if (!GROWTH_EVENT_NAMES.includes(eventName)) return false;
  const normalized = normalizeAcquisition(acquisition);
  await pool.query(
    `INSERT INTO growth_events (
       user_id, event_name, plan_tier, source, medium, campaign, referral_code, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      userId,
      eventName,
      cleanText(planTier, 30),
      normalized.source,
      normalized.medium,
      normalized.campaign,
      cleanReferralCode(referralCode) || normalized.referralCode,
      JSON.stringify(safeMetadata(metadata))
    ]
  );
  return true;
}

async function captureRegistrationGrowth({ pool, userId, acquisition } = {}) {
  const normalized = normalizeAcquisition(acquisition);
  const ownCode = await ensureReferralCode(pool, userId);
  let referrerUserId = null;

  if (normalized.referralCode && normalized.referralCode !== ownCode) {
    const referrer = await pool.query(
      "SELECT user_id FROM growth_referral_codes WHERE code = $1 LIMIT 1",
      [normalized.referralCode]
    );
    const candidate = referrer.rows[0]?.user_id || null;
    if (candidate && String(candidate) !== String(userId)) {
      referrerUserId = candidate;
    }
  }

  await pool.query(
    `INSERT INTO growth_attributions (
       user_id, referrer_user_id, referral_code, source, medium, campaign, content, landing_path
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO NOTHING`,
    [
      userId,
      referrerUserId,
      normalized.referralCode,
      normalized.source,
      normalized.medium,
      normalized.campaign,
      normalized.content,
      normalized.landingPath
    ]
  );

  await recordGrowthEvent(pool, {
    userId,
    eventName: "account_registered",
    acquisition: normalized,
    referralCode: normalized.referralCode,
    metadata: { referred: Boolean(referrerUserId) }
  });

  if (referrerUserId) {
    await recordGrowthEvent(pool, {
      userId: referrerUserId,
      eventName: "referral_signup",
      referralCode: normalized.referralCode,
      metadata: { converted: true }
    });
  }

  return { referralCode: ownCode, referred: Boolean(referrerUserId) };
}

async function getGrowthAdminSummary(pool, days = 30) {
  const parsedDays = Number.parseInt(String(days || "30"), 10);
  const windowDays = Math.min(365, Math.max(1, Number.isFinite(parsedDays) ? parsedDays : 30));

  const [
    registrationsResult,
    eventsResult,
    activePaidResult,
    planMixResult,
    sourcesResult,
    campaignsResult,
    referralResult,
    landingPagesResult
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM users
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
      [windowDays]
    ),
    pool.query(
      `SELECT event_name, COUNT(*)::int AS count
       FROM growth_events
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY event_name`,
      [windowDays]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM account_subscriptions
       WHERE status IN ('active', 'trialing')
         AND plan_tier IN ('premium', 'ultra', 'max')`
    ),
    pool.query(
      `SELECT plan_tier, COUNT(*)::int AS count
       FROM account_subscriptions
       WHERE status IN ('active', 'trialing')
         AND plan_tier IN ('premium', 'ultra', 'max')
       GROUP BY plan_tier
       ORDER BY plan_tier`
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(source, ''), '(direct / unknown)') AS label,
              COUNT(*)::int AS registrations
       FROM growth_attributions
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY COALESCE(NULLIF(source, ''), '(direct / unknown)')
       ORDER BY registrations DESC, label ASC
       LIMIT 12`,
      [windowDays]
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(campaign, ''), '(none)') AS label,
              COUNT(*)::int AS registrations
       FROM growth_attributions
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY COALESCE(NULLIF(campaign, ''), '(none)')
       ORDER BY registrations DESC, label ASC
       LIMIT 12`,
      [windowDays]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM growth_attributions
       WHERE referrer_user_id IS NOT NULL
         AND created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
      [windowDays]
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(metadata->>'feature', ''), '(unknown)') AS label,
              COUNT(*)::int AS views
       FROM growth_events
       WHERE event_name = 'landing_view'
         AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY COALESCE(NULLIF(metadata->>'feature', ''), '(unknown)')
       ORDER BY views DESC, label ASC
       LIMIT 20`,
      [windowDays]
    )
  ]);

  const eventCounts = Object.fromEntries(
    eventsResult.rows.map((row) => [String(row.event_name), Number(row.count || 0)])
  );
  const landingViews = Number(eventCounts.landing_view || 0);
  const registrations = Number(registrationsResult.rows[0]?.count || 0);
  const checkoutStarts = Number(eventCounts.checkout_started || 0);
  const paidActivations = Number(eventCounts.subscription_activated || 0);
  const churned = Number(eventCounts.subscription_churned || 0);
  const referredRegistrations = Number(referralResult.rows[0]?.count || 0);

  return {
    windowDays,
    generatedAt: new Date().toISOString(),
    funnel: {
      landingViews,
      registrations,
      checkoutStarts,
      paidActivations,
      churned,
      referredRegistrations,
      landingViewToRegistrationRatio: landingViews > 0 ? registrations / landingViews : 0,
      registrationToCheckoutRate: registrations > 0 ? checkoutStarts / registrations : 0,
      registrationToPaidRate: registrations > 0 ? paidActivations / registrations : 0,
      referralShare: registrations > 0 ? referredRegistrations / registrations : 0
    },
    activePaidSubscribers: Number(activePaidResult.rows[0]?.count || 0),
    activePlanMix: planMixResult.rows.map((row) => ({
      planTier: String(row.plan_tier || ""),
      count: Number(row.count || 0)
    })),
    registrationsBySource: sourcesResult.rows.map((row) => ({
      label: String(row.label || "(unknown)"),
      registrations: Number(row.registrations || 0)
    })),
    registrationsByCampaign: campaignsResult.rows.map((row) => ({
      label: String(row.label || "(none)"),
      registrations: Number(row.registrations || 0)
    })),
    landingViewsByFeature: landingPagesResult.rows.map((row) => ({
      label: String(row.label || "(unknown)"),
      views: Number(row.views || 0)
    }))
  };
}

async function getReferralSummary(pool, userId, publicOrigin = "") {
  const code = await ensureReferralCode(pool, userId);
  const countResult = await pool.query(
    "SELECT COUNT(*)::int AS referred_accounts FROM growth_attributions WHERE referrer_user_id = $1",
    [userId]
  );
  const origin = String(publicOrigin || "").trim().replace(/\/+$/, "");
  const referralLink = origin ? `${origin}/?ref=${encodeURIComponent(code)}` : `/?ref=${encodeURIComponent(code)}`;

  return {
    code,
    referralLink,
    referredAccounts: Number(countResult.rows[0]?.referred_accounts || 0)
  };
}

module.exports = {
  GROWTH_EVENT_NAMES,
  cleanText,
  cleanReferralCode,
  cleanLandingPath,
  normalizeAcquisition,
  safeMetadata,
  initializeGrowthSchema,
  ensureReferralCode,
  recordGrowthEvent,
  captureRegistrationGrowth,
  getReferralSummary,
  getGrowthAdminSummary
};
