const express = require("express");
const path = require("path");

function clampDays(value) {
  const parsed = Number.parseInt(String(value || "30"), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 365) : 30;
}

function publicAiStatus(status = {}) {
  return {
    provider: status.provider || null,
    configured: Boolean(status.configured),
    model: status.model || null,
    streaming: Boolean(status.streaming),
    research: Boolean(status.research),
    fileAnalysis: Boolean(status.fileAnalysis),
    error: status.error || null
  };
}

function publicGatewayStatus(status = {}) {
  return {
    provider: status.provider || null,
    configured: Boolean(status.configured),
    state: status.state || null
  };
}

function publicMaintenanceStatus(status = {}) {
  return {
    mode: status.mode || "off",
    active: Boolean(status.active),
    writeBlocked: Boolean(status.writeBlocked),
    retryAfterSeconds: Number(status.retryAfterSeconds || 0)
  };
}

function createCommandCenterRouter({
  getPool,
  buildAccountAccess,
  getGatewayStatus,
  getBillingGatewayStatus,
  getAgeVerificationGatewayStatus,
  getMaintenanceStatus
} = {}) {
  if (typeof getPool !== "function") {
    throw new Error("Command Center requires a database pool provider.");
  }
  if (typeof buildAccountAccess !== "function") {
    throw new Error("Command Center requires account access resolution.");
  }

  const router = express.Router();

  router.get("/overview", async (req, res) => {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: "Command Center data is temporarily unavailable." });
    }

    const days = clampDays(req.query.days);

    try {
      const [
        access,
        usageResult,
        usageTypesResult,
        conversationResult,
        securityResult,
        taskResult,
        agentResult,
        memoryResult
      ] = await Promise.all([
        buildAccountAccess(req.user),
        pool.query(
          `SELECT
             COUNT(*)::bigint AS requests,
             COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
             COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
             COALESCE(SUM(web_search_calls), 0)::bigint AS web_search_calls,
             COUNT(estimated_cost_micros)::bigint AS priced_events,
             COALESCE(SUM(estimated_cost_micros), 0)::bigint AS estimated_cost_micros
           FROM usage_events
           WHERE user_id = $1
             AND created_at >= NOW() - ($2::text || ' days')::interval`,
          [req.user.id, days]
        ),
        pool.query(
          `SELECT
             event_type,
             provider,
             model,
             COUNT(*)::bigint AS requests,
             COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
             COALESCE(SUM(web_search_calls), 0)::bigint AS web_search_calls,
             COALESCE(SUM(estimated_cost_micros), 0)::bigint AS estimated_cost_micros
           FROM usage_events
           WHERE user_id = $1
             AND created_at >= NOW() - ($2::text || ' days')::interval
           GROUP BY event_type, provider, model
           ORDER BY requests DESC, total_tokens DESC
           LIMIT 25`,
          [req.user.id, days]
        ),
        pool.query(
          `SELECT
             COUNT(DISTINCT c.id)::bigint AS conversations,
             COUNT(m.id)::bigint AS messages,
             MAX(c.updated_at) AS last_conversation_at
           FROM conversations c
           LEFT JOIN conversation_messages m ON m.conversation_id = c.id
           WHERE c.user_id = $1`,
          [req.user.id]
        ),
        pool.query(
          `SELECT
             (SELECT COUNT(*) FROM user_sessions
              WHERE user_id = $1 AND expires_at > NOW())::bigint AS active_sessions,
             (SELECT COUNT(*) FROM account_devices
              WHERE user_id = $1 AND revoked_at IS NULL)::bigint AS active_devices,
             (SELECT COUNT(*) FROM account_security_alerts
              WHERE user_id = $1 AND acknowledged_at IS NULL)::bigint AS unread_alerts,
             (SELECT MAX(created_at) FROM account_security_events
              WHERE user_id = $1) AS last_security_event_at`,
          [req.user.id]
        ),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE enabled = TRUE)::bigint AS active_tasks,
             MIN(next_run_at) FILTER (
               WHERE enabled = TRUE AND next_run_at IS NOT NULL
             ) AS next_run_at,
             (SELECT COUNT(*)
              FROM scheduled_task_events
              WHERE user_id = $1 AND acknowledged_at IS NULL)::bigint AS unread_events
           FROM scheduled_tasks
           WHERE user_id = $1`,
          [req.user.id]
        ),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'queued')::bigint AS queued_runs,
             COUNT(*) FILTER (WHERE status = 'running')::bigint AS running_runs,
             COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed_runs,
             COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed_runs,
             MAX(updated_at) AS last_agent_activity_at
           FROM agent_runs
           WHERE user_id = $1`,
          [req.user.id]
        ),
        pool.query(
          `SELECT
             COUNT(*)::bigint AS total_memories,
             COUNT(*) FILTER (WHERE enabled = TRUE)::bigint AS enabled_memories,
             MAX(updated_at) AS last_memory_update_at
           FROM user_memories
           WHERE user_id = $1`,
          [req.user.id]
        )
      ]);

      const usage = usageResult.rows[0] || {};
      const conversations = conversationResult.rows[0] || {};
      const security = securityResult.rows[0] || {};
      const tasks = taskResult.rows[0] || {};
      const agents = agentResult.rows[0] || {};
      const memory = memoryResult.rows[0] || {};
      const ai = typeof getGatewayStatus === "function" ? getGatewayStatus() : {};
      const billing =
        typeof getBillingGatewayStatus === "function" ? getBillingGatewayStatus() : {};
      const ageVerification =
        typeof getAgeVerificationGatewayStatus === "function"
          ? getAgeVerificationGatewayStatus()
          : {};
      const maintenance =
        typeof getMaintenanceStatus === "function" ? getMaintenanceStatus() : {};

      return res.json({
        days,
        account: {
          id: String(req.user.id),
          displayName: req.user.display_name || req.user.displayName || "UNBOUND User",
          role: req.user.role || "user"
        },
        access,
        usage: {
          totals: {
            requests: Number(usage.requests || 0),
            inputTokens: Number(usage.input_tokens || 0),
            outputTokens: Number(usage.output_tokens || 0),
            totalTokens: Number(usage.total_tokens || 0),
            webSearchCalls: Number(usage.web_search_calls || 0),
            pricedEvents: Number(usage.priced_events || 0),
            estimatedCostMicros: Number(usage.estimated_cost_micros || 0)
          },
          activity: usageTypesResult.rows.map((row) => ({
            eventType: row.event_type,
            provider: row.provider,
            model: row.model,
            requests: Number(row.requests || 0),
            totalTokens: Number(row.total_tokens || 0),
            webSearchCalls: Number(row.web_search_calls || 0),
            estimatedCostMicros: Number(row.estimated_cost_micros || 0)
          }))
        },
        conversations: {
          count: Number(conversations.conversations || 0),
          messages: Number(conversations.messages || 0),
          lastConversationAt: conversations.last_conversation_at || null
        },
        security: {
          activeSessions: Number(security.active_sessions || 0),
          activeDevices: Number(security.active_devices || 0),
          unreadAlerts: Number(security.unread_alerts || 0),
          lastSecurityEventAt: security.last_security_event_at || null
        },
        tasks: {
          active: Number(tasks.active_tasks || 0),
          unreadEvents: Number(tasks.unread_events || 0),
          nextRunAt: tasks.next_run_at || null
        },
        agents: {
          queued: Number(agents.queued_runs || 0),
          running: Number(agents.running_runs || 0),
          completed: Number(agents.completed_runs || 0),
          failed: Number(agents.failed_runs || 0),
          lastActivityAt: agents.last_agent_activity_at || null
        },
        memory: {
          total: Number(memory.total_memories || 0),
          enabled: Number(memory.enabled_memories || 0),
          lastUpdatedAt: memory.last_memory_update_at || null
        },
        platform: {
          ai: publicAiStatus(ai),
          billing: publicGatewayStatus(billing),
          ageVerification: publicGatewayStatus(ageVerification),
          maintenance: publicMaintenanceStatus(maintenance)
        }
      });
    } catch (error) {
      console.error("UNBOUND AI COMMAND CENTER OVERVIEW ERROR:", error);
      return res.status(500).json({ error: "Could not load Command Center data." });
    }
  });

  return router;
}

function sendCommandCenterPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "command-center.html"));
}

module.exports = {
  clampDays,
  publicAiStatus,
  publicGatewayStatus,
  publicMaintenanceStatus,
  createCommandCenterRouter,
  sendCommandCenterPage
};
