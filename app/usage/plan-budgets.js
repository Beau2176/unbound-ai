const { getPlanDefinition, normalizePlanTier } = require("../access/entitlements");

const USD_TO_MICROS = 1_000_000;

const DEFAULT_PLAN_USAGE_LIMITS = Object.freeze({
  free: Object.freeze({
    estimatedCostUsd: 1,
    chatEvents: 1500,
    webSearchCalls: 0,
    fileAnalysisEvents: 0,
    artifactEvents: 0,
    imageUnderstandingEvents: 0,
    imageToolEvents: 0,
    voiceEvents: 0,
    agentStepEvents: 0
  }),
  premium: Object.freeze({
    estimatedCostUsd: 8,
    chatEvents: 8000,
    webSearchCalls: 400,
    fileAnalysisEvents: 500,
    artifactEvents: 300,
    imageUnderstandingEvents: 500,
    imageToolEvents: 0,
    voiceEvents: 500,
    agentStepEvents: 0
  }),
  ultra: Object.freeze({
    estimatedCostUsd: 30,
    chatEvents: 30000,
    webSearchCalls: 1500,
    fileAnalysisEvents: 2500,
    artifactEvents: 1500,
    imageUnderstandingEvents: 2000,
    imageToolEvents: 100,
    voiceEvents: 1500,
    agentStepEvents: 400
  }),
  max: Object.freeze({
    estimatedCostUsd: 70,
    chatEvents: 75000,
    webSearchCalls: 3500,
    fileAnalysisEvents: 6000,
    artifactEvents: 4000,
    imageUnderstandingEvents: 5000,
    imageToolEvents: 300,
    voiceEvents: 3500,
    agentStepEvents: 1200
  })
});

const CATEGORY_TO_USAGE_FIELD = Object.freeze({
  chat: "chatEvents",
  research: "webSearchCalls",
  file_analysis: "fileAnalysisEvents",
  artifact: "artifactEvents",
  image_understanding: "imageUnderstandingEvents",
  image_tools: "imageToolEvents",
  voice: "voiceEvents",
  agent: "agentStepEvents"
});

function envKey(planTier, field) {
  return `UNBOUND_USAGE_${String(planTier || "").toUpperCase()}_${String(field || "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase()}`;
}

function finiteNonNegative(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getPlanUsageLimits(planTier, env = process.env) {
  const plan = normalizePlanTier(planTier);
  const defaults = DEFAULT_PLAN_USAGE_LIMITS[plan] || DEFAULT_PLAN_USAGE_LIMITS.free;
  const estimatedCostUsd = finiteNonNegative(
    env[envKey(plan, "estimatedCostUsd")],
    defaults.estimatedCostUsd
  );

  const limits = {
    estimatedCostMicros: Math.round(estimatedCostUsd * USD_TO_MICROS)
  };
  for (const field of [
    "chatEvents",
    "webSearchCalls",
    "fileAnalysisEvents",
    "artifactEvents",
    "imageUnderstandingEvents",
    "imageToolEvents",
    "voiceEvents",
    "agentStepEvents"
  ]) {
    limits[field] = Math.floor(
      finiteNonNegative(env[envKey(plan, field)], defaults[field])
    );
  }
  return Object.freeze(limits);
}

function nextCalendarMonthIso(now = new Date()) {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
}

function usageBudgetError({ planTier, field, limit, resetAt }) {
  const plan = getPlanDefinition(planTier);
  const error = new Error(
    `${plan.displayName} monthly usage allowance reached. Usage resets at the start of the next calendar month.`
  );
  error.code = "USAGE_MONTHLY_LIMIT_REACHED";
  error.statusCode = 429;
  error.publicMessage = error.message;
  error.usageBudget = {
    planTier: plan.id,
    field,
    limit,
    resetAt
  };
  return error;
}

async function resolveEffectivePlanTier(pool, userId) {
  const result = await pool.query(
    `SELECT
       u.role,
       u.plan_tier AS manual_plan_tier,
       EXISTS (
         SELECT 1
         FROM complimentary_top_tier_grants g
         WHERE g.user_id = u.id
       ) AS complimentary_top_tier,
       s.status AS subscription_status,
       s.plan_tier AS subscription_plan_tier
     FROM users u
     LEFT JOIN account_subscriptions s ON s.user_id = u.id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return "free";
  if (row.role === "admin" || row.complimentary_top_tier) return "ultra";

  const manual = getPlanDefinition(row.manual_plan_tier);
  const subscriptionActive = ["active", "trialing"].includes(
    String(row.subscription_status || "").trim().toLowerCase()
  );
  const subscription = subscriptionActive
    ? getPlanDefinition(row.subscription_plan_tier)
    : getPlanDefinition("free");

  return subscription.rank > manual.rank ? subscription.id : manual.id;
}

async function loadMonthlyUsage(pool, userId) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(estimated_cost_micros), 0)::bigint AS estimated_cost_micros,
       COUNT(*) FILTER (WHERE event_type LIKE 'chat_%')::bigint AS chat_events,
       COALESCE(SUM(web_search_calls), 0)::bigint AS web_search_calls,
       COUNT(*) FILTER (WHERE event_type = 'file_analysis')::bigint AS file_analysis_events,
       COUNT(*) FILTER (WHERE event_type = 'artifact_plan')::bigint AS artifact_events,
       COUNT(*) FILTER (WHERE event_type = 'image_understanding')::bigint AS image_understanding_events,
       COUNT(*) FILTER (WHERE event_type IN ('image_generation', 'image_edit'))::bigint AS image_tool_events,
       COUNT(*) FILTER (WHERE event_type = 'voice_speech')::bigint AS voice_events,
       COUNT(*) FILTER (WHERE event_type IN ('agent_step', 'agent_research_step'))::bigint AS agent_step_events
     FROM usage_events
     WHERE user_id = $1
       AND created_at >= DATE_TRUNC('month', NOW())`,
    [userId]
  );
  const row = result.rows[0] || {};
  return {
    estimatedCostMicros: Number(row.estimated_cost_micros || 0),
    chatEvents: Number(row.chat_events || 0),
    webSearchCalls: Number(row.web_search_calls || 0),
    fileAnalysisEvents: Number(row.file_analysis_events || 0),
    artifactEvents: Number(row.artifact_events || 0),
    imageUnderstandingEvents: Number(row.image_understanding_events || 0),
    imageToolEvents: Number(row.image_tool_events || 0),
    voiceEvents: Number(row.voice_events || 0),
    agentStepEvents: Number(row.agent_step_events || 0)
  };
}

function publicUsageBudgetState({ planTier, limits, usage, resetAt }) {
  const plan = getPlanDefinition(planTier);
  const remaining = {};
  for (const field of Object.keys(usage)) {
    const limit = limits[field];
    remaining[field] =
      Number.isFinite(limit) && limit >= 0
        ? Math.max(0, limit - Number(usage[field] || 0))
        : null;
  }
  return {
    planTier: plan.id,
    planName: plan.displayName,
    resetAt,
    limits,
    usage,
    remaining
  };
}

async function getUsageBudgetState({ pool, userId, env = process.env } = {}) {
  if (!pool || !userId) return null;
  const planTier = await resolveEffectivePlanTier(pool, userId);
  const [limits, usage] = await Promise.all([
    Promise.resolve(getPlanUsageLimits(planTier, env)),
    loadMonthlyUsage(pool, userId)
  ]);
  return publicUsageBudgetState({
    planTier,
    limits,
    usage,
    resetAt: nextCalendarMonthIso()
  });
}

async function assertUsageBudget({
  pool,
  userId,
  category = "chat",
  env = process.env
} = {}) {
  if (!pool || !userId) return null;
  const state = await getUsageBudgetState({ pool, userId, env });
  if (!state) return null;

  if (
    state.limits.estimatedCostMicros >= 0 &&
    state.usage.estimatedCostMicros >= state.limits.estimatedCostMicros
  ) {
    throw usageBudgetError({
      planTier: state.planTier,
      field: "estimatedCostMicros",
      limit: state.limits.estimatedCostMicros,
      resetAt: state.resetAt
    });
  }

  const field = CATEGORY_TO_USAGE_FIELD[category] || CATEGORY_TO_USAGE_FIELD.chat;
  const limit = state.limits[field];
  const used = state.usage[field];
  if (Number.isFinite(limit) && used >= limit) {
    throw usageBudgetError({
      planTier: state.planTier,
      field,
      limit,
      resetAt: state.resetAt
    });
  }

  return state;
}

module.exports = {
  USD_TO_MICROS,
  DEFAULT_PLAN_USAGE_LIMITS,
  CATEGORY_TO_USAGE_FIELD,
  envKey,
  getPlanUsageLimits,
  nextCalendarMonthIso,
  usageBudgetError,
  resolveEffectivePlanTier,
  loadMonthlyUsage,
  publicUsageBudgetState,
  getUsageBudgetState,
  assertUsageBudget
};
