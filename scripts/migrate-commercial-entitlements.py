from pathlib import Path

path = Path("app/server.js")
server = path.read_text()


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return source.replace(old, new, 1)


def replace_exact_count(source, old, new, expected, label):
    count = source.count(old)
    if count != expected:
        raise RuntimeError(f"{label}: expected {expected} matches, found {count}")
    return source.replace(old, new)

server = replace_once(
    server,
    'const { generateChat, streamChat, getGatewayStatus } = require("./ai/gateway");',
    'const { generateChat, streamChat, getGatewayStatus } = require("./ai/gateway");\nconst {\n  normalizePlanTier,\n  getPlanDefinition,\n  buildCapabilityAccess\n} = require("./access/entitlements");',
    "entitlement import",
)

subscription_schema = r'''
    CREATE TABLE IF NOT EXISTS account_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT,
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'none',
      plan_tier TEXT NOT NULL DEFAULT 'free',
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS account_subscriptions_provider_subscription_idx
      ON account_subscriptions(provider, provider_subscription_id)
      WHERE provider_subscription_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS account_subscriptions_status_idx
      ON account_subscriptions(status, plan_tier);

    CREATE TABLE IF NOT EXISTS account_entitlement_overrides (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entitlement_key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL,
      reason TEXT,
      expires_at TIMESTAMPTZ,
      created_by_admin_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, entitlement_key)
    );

    CREATE INDEX IF NOT EXISTS account_entitlement_overrides_user_idx
      ON account_entitlement_overrides(user_id, entitlement_key);

'''

server = replace_once(
    server,
    '    CREATE TABLE IF NOT EXISTS complimentary_top_tier_grants (',
    subscription_schema + '    CREATE TABLE IF NOT EXISTS complimentary_top_tier_grants (',
    "commercial schema",
)

access_helpers = r'''
function subscriptionStatusAllowsAccess(status) {
  return ["active", "trialing"].includes(
    String(status || "").trim().toLowerCase()
  );
}

async function loadAccountSubscription(userId, client = pool) {
  const result = await client.query(
    `SELECT
       provider,
       status,
       plan_tier,
       current_period_start,
       current_period_end,
       cancel_at_period_end,
       created_at,
       updated_at
     FROM account_subscriptions
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function loadEntitlementOverrides(userId, client = pool) {
  const result = await client.query(
    `SELECT entitlement_key, enabled, reason, expires_at
     FROM account_entitlement_overrides
     WHERE user_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY entitlement_key`,
    [userId]
  );

  return result.rows;
}

function resolveEffectivePlan(user, subscription) {
  const manualPlan = getPlanDefinition(user?.plan_tier);

  if (user?.role === "admin") {
    return {
      plan: getPlanDefinition("top"),
      source: "administrator"
    };
  }

  if (user?.complimentary_top_tier) {
    return {
      plan: getPlanDefinition("top"),
      source: "complimentary"
    };
  }

  const subscriptionPlan =
    subscription && subscriptionStatusAllowsAccess(subscription.status)
      ? getPlanDefinition(subscription.plan_tier)
      : getPlanDefinition("free");

  if (subscriptionPlan.rank > manualPlan.rank) {
    return {
      plan: subscriptionPlan,
      source: "subscription"
    };
  }

  return {
    plan: manualPlan,
    source: manualPlan.id === "free" ? "default" : "manual"
  };
}

async function buildAccountAccess(user) {
  if (!user || !databaseReady || !pool) {
    return null;
  }

  const [subscription, overrides] = await Promise.all([
    loadAccountSubscription(user.id),
    loadEntitlementOverrides(user.id)
  ]);
  const effective = resolveEffectivePlan(user, subscription);
  const capabilities = buildCapabilityAccess({
    planTier: effective.plan.id,
    overrides
  });

  return {
    plan: {
      tier: effective.plan.id,
      displayName: effective.plan.displayName,
      source: effective.source
    },
    subscription: {
      connected: Boolean(subscription && subscription.provider),
      provider: subscription?.provider || null,
      status: subscription?.status || "none",
      planTier: subscription
        ? normalizePlanTier(subscription.plan_tier)
        : null,
      currentPeriodStart: subscription?.current_period_start || null,
      currentPeriodEnd: subscription?.current_period_end || null,
      cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end)
    },
    capabilities,
    summary: {
      usable: capabilities.filter((item) => item.usable).length,
      entitledButNotLive: capabilities.filter(
        (item) => item.entitled && !item.available
      ).length,
      catalogSize: capabilities.length
    }
  };
}

function requireCapability(capabilityKey) {
  return async function capabilityMiddleware(req, res, next) {
    try {
      const user = req.user || (await findSessionUser(req));
      if (!user) {
        return res.status(401).json({
          error: "Sign in to access that UNBOUND AI capability."
        });
      }

      const access = await buildAccountAccess(user);
      const capability = access?.capabilities.find(
        (item) => item.key === capabilityKey
      );

      if (!capability || !capability.usable) {
        return res.status(403).json({
          error: capability?.entitled && !capability?.available
            ? "That capability is included in your access level but is not live yet."
            : "Your current access level does not include that capability.",
          capability: capability || null
        });
      }

      req.user = user;
      req.accountAccess = access;
      next();
    } catch (error) {
      console.error("UNBOUND AI ENTITLEMENT ERROR:", error);
      return res.status(500).json({
        error: "Could not verify account access."
      });
    }
  };
}

'''

server = replace_once(
    server,
    'async function requireSignedIn(req, res, next) {',
    access_helpers + 'async function requireSignedIn(req, res, next) {',
    "access helpers",
)

server = replace_once(
    server,
    '        error: "Sign in to access your UNBOUND AI conversation history."',
    '        error: "Sign in to access your UNBOUND AI account."',
    "generic signed-in message",
)

account_access_route = r'''

app.get(
  "/api/account/access",
  requireDatabase,
  requireSignedIn,
  async (req, res) => {
    try {
      const access = await buildAccountAccess(req.user);
      return res.json({
        user: publicUser(req.user),
        access
      });
    } catch (error) {
      console.error("UNBOUND AI ACCOUNT ACCESS ERROR:", error);
      return res.status(500).json({
        error: "Could not load account access."
      });
    }
  }
);
'''

server = replace_once(
    server,
    '\n/* ------------------------- CONVERSATION HISTORY ------------------------ */',
    account_access_route + '\n/* ------------------------- CONVERSATION HISTORY ------------------------ */',
    "account access endpoint",
)

server = replace_once(
    server,
    '    ai: getGatewayStatus()\n  });',
    '    ai: getGatewayStatus(),\n    commercial: databaseReady ? "entitlements-ready" : "not-ready"\n  });',
    "health commercial status",
)

# Prove the central entitlement middleware controls the already-live history capability.
old_conversations = '  "/api/conversations",\n  requireDatabase,\n  requireSignedIn,\n'
new_conversations = '  "/api/conversations",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("server_history"),\n'
server = replace_exact_count(
    server,
    old_conversations,
    new_conversations,
    2,
    "history gate list/create routes",
)

old_import = '  "/api/conversations/import",\n  requireDatabase,\n  requireSignedIn,\n'
new_import = '  "/api/conversations/import",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("server_history"),\n'
server = replace_once(
    server,
    old_import,
    new_import,
    "history gate import route",
)

old_id = '  "/api/conversations/:id",\n  requireDatabase,\n  requireSignedIn,\n'
new_id = '  "/api/conversations/:id",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("server_history"),\n'
server = replace_exact_count(
    server,
    old_id,
    new_id,
    2,
    "history gate conversation id routes",
)

path.write_text(server)
print("Commercial entitlement migration applied.")
