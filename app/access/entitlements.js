const PLAN_DEFINITIONS = Object.freeze({
  free: Object.freeze({
    id: "free",
    displayName: "FREE",
    rank: 0
  }),
  top: Object.freeze({
    id: "top",
    displayName: "TOP",
    rank: 100
  })
});

const CAPABILITY_CATALOG = Object.freeze({
  chat: Object.freeze({
    label: "AI chat",
    description: "Core UNBOUND AI conversation access.",
    implemented: true,
    minimumPlan: "free"
  }),
  casual_mode: Object.freeze({
    label: "Casual Mode",
    description: "Fast, concise response-depth style.",
    implemented: true,
    minimumPlan: "free"
  }),
  work_mode: Object.freeze({
    label: "Work Mode",
    description: "Deeper response-depth style with fuller analysis.",
    implemented: true,
    minimumPlan: "free"
  }),
  streaming: Object.freeze({
    label: "Streaming responses",
    description: "Answers appear progressively as they are generated.",
    implemented: true,
    minimumPlan: "free"
  }),
  server_history: Object.freeze({
    label: "Cross-device conversation history",
    description: "Signed-in chats are stored in the account database.",
    implemented: true,
    minimumPlan: "free"
  }),
  web_research: Object.freeze({
    label: "Web research",
    description: "Live source-driven web research.",
    implemented: false,
    minimumPlan: "top"
  }),
  citations: Object.freeze({
    label: "Research citations",
    description: "Source citations attached to research answers.",
    implemented: false,
    minimumPlan: "top"
  }),
  file_analysis: Object.freeze({
    label: "File analysis",
    description: "Upload and analyze supported documents and data files.",
    implemented: false,
    minimumPlan: "top"
  }),
  image_tools: Object.freeze({
    label: "Image tools",
    description: "Image understanding, generation, and editing workflows.",
    implemented: false,
    minimumPlan: "top"
  }),
  voice: Object.freeze({
    label: "Voice conversation",
    description: "Natural spoken conversation with UNBOUND AI.",
    implemented: false,
    minimumPlan: "top"
  }),
  agents: Object.freeze({
    label: "Authorized agents",
    description: "Permission-based task execution and browser automation.",
    implemented: false,
    minimumPlan: "top"
  }),
  monitoring: Object.freeze({
    label: "Monitoring and scheduled tasks",
    description: "Recurring checks, reminders, and condition-based monitoring.",
    implemented: false,
    minimumPlan: "top"
  }),
  multi_model: Object.freeze({
    label: "Multi-model routing",
    description: "Route work across multiple supported model providers.",
    implemented: false,
    minimumPlan: "top"
  }),
  connected_apps: Object.freeze({
    label: "Connected apps",
    description: "Permission-based connections to external services.",
    implemented: false,
    minimumPlan: "top"
  }),
  command_center: Object.freeze({
    label: "UNBOUND Command Center",
    description: "Central controls for agents, permissions, usage, costs, and task history.",
    implemented: false,
    minimumPlan: "top"
  })
});

function normalizePlanTier(value) {
  return String(value || "").trim().toLowerCase() === "top" ? "top" : "free";
}

function getPlanDefinition(value) {
  return PLAN_DEFINITIONS[normalizePlanTier(value)];
}

function isKnownCapability(value) {
  return Object.prototype.hasOwnProperty.call(
    CAPABILITY_CATALOG,
    String(value || "").trim()
  );
}

function buildCapabilityAccess({ planTier, overrides = [] } = {}) {
  const plan = getPlanDefinition(planTier);
  const now = Date.now();
  const overrideMap = new Map();

  for (const item of Array.isArray(overrides) ? overrides : []) {
    const key = String(item?.entitlement_key || item?.key || "").trim();
    if (!isKnownCapability(key)) continue;

    const expiresAt = item?.expires_at || item?.expiresAt || null;
    if (expiresAt && new Date(expiresAt).getTime() <= now) continue;

    overrideMap.set(key, item);
  }

  return Object.entries(CAPABILITY_CATALOG).map(([key, capability]) => {
    const minimumPlan = getPlanDefinition(capability.minimumPlan);
    const planEntitled = plan.rank >= minimumPlan.rank;
    const override = overrideMap.get(key);
    const entitled = override ? Boolean(override.enabled) : planEntitled;
    const available = Boolean(capability.implemented);

    return {
      key,
      label: capability.label,
      description: capability.description,
      entitled,
      available,
      usable: entitled && available,
      source: override ? "override" : "plan",
      minimumPlan: minimumPlan.id
    };
  });
}

module.exports = {
  PLAN_DEFINITIONS,
  CAPABILITY_CATALOG,
  normalizePlanTier,
  getPlanDefinition,
  isKnownCapability,
  buildCapabilityAccess
};
