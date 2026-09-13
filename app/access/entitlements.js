const PLAN_DEFINITIONS = Object.freeze({
  free: Object.freeze({ id: "free", displayName: "FREE", rank: 0 }),
  top: Object.freeze({ id: "top", displayName: "TOP", rank: 100 })
});

const CAPABILITY_CATALOG = Object.freeze({
  chat: Object.freeze({ label: "AI chat", description: "Core UNBOUND AI conversation access.", implemented: true, minimumPlan: "free" }),
  casual_mode: Object.freeze({ label: "Casual Mode", description: "Fast, concise response-depth style.", implemented: true, minimumPlan: "free" }),
  work_mode: Object.freeze({ label: "Work Mode", description: "Deeper response-depth style with fuller analysis.", implemented: true, minimumPlan: "free" }),
  streaming: Object.freeze({ label: "Streaming responses", description: "Answers appear progressively as they are generated.", implemented: true, minimumPlan: "free" }),
  server_history: Object.freeze({ label: "Cross-device conversation history", description: "Signed-in chats are stored in the account database.", implemented: true, minimumPlan: "free" }),
  web_research: Object.freeze({ label: "Web research", description: "Live source-driven web research using the configured AI provider.", implemented: true, minimumPlan: "top" }),
  citations: Object.freeze({ label: "Research citations", description: "Source citations and source metadata attached to Research Mode answers.", implemented: true, minimumPlan: "top" }),
  creative_mode: Object.freeze({ label: "Creative Mode", description: "Idea generation, writing, brainstorming, worldbuilding, and creative collaboration.", implemented: true, minimumPlan: "free" }),
  unbound_mode: Object.freeze({ label: "Unbound Mode", description: "Candid, direct conversation with fewer unnecessary caveats while retaining core safety boundaries.", implemented: true, minimumPlan: "free" }),
  adult_mode: Object.freeze({ label: "Adult Mode", description: "Verified-18+ mature conversation protected by a server-side hard age-verification gate.", implemented: true, minimumPlan: "free" }),
  data_export: Object.freeze({ label: "Download My Data", description: "Download a privacy-safe JSON copy of account data and conversation history.", implemented: true, minimumPlan: "free" }),
  account_deletion: Object.freeze({ label: "Delete My Account", description: "Permanently delete the account and personal account data after re-authentication and billing safety checks.", implemented: true, minimumPlan: "free" }),
  legal_consent: Object.freeze({ label: "Privacy & Terms controls", description: "Versioned Terms of Use and Privacy Notice acceptance records with account-visible status.", implemented: true, minimumPlan: "free" }),
  file_analysis: Object.freeze({ label: "File analysis", description: "Upload and analyze supported documents and data files without storing the raw upload in UNBOUND AI.", implemented: true, minimumPlan: "top" }),
  image_understanding: Object.freeze({ label: "Image understanding", description: "Upload an image for visual analysis without storing the raw upload in UNBOUND AI.", implemented: true, minimumPlan: "top" }),
  image_tools: Object.freeze({ label: "Image tools", description: "Generate new images and edit supported source images without storing raw image bytes in UNBOUND AI.", implemented: true, minimumPlan: "top" }),
  voice: Object.freeze({ label: "Voice conversation", description: "Natural spoken conversation with UNBOUND AI using the Boyd Voice V3 private voice clone.", implemented: true, minimumPlan: "top" }),
  memory: Object.freeze({ label: "User-controlled Memory", description: "Explicit saved context that the user can review, pause, edit, or delete and that is used only in signed-in chat when enabled.", implemented: true, minimumPlan: "top" }),
  agents: Object.freeze({ label: "Bounded Agents", description: "Queued multi-step Agent runs for analysis, drafting, planning, and optional source-backed web research. External actions remain disabled until separately connected and authorized.", implemented: true, minimumPlan: "top" }),
  monitoring: Object.freeze({ label: "Scheduled tasks & reminders", description: "Database-backed one-time and recurring reminders with in-app and browser alerts while Task Center is open.", implemented: true, minimumPlan: "top" }),
  multi_model: Object.freeze({ label: "Multi-model routing", description: "Route TOP chat through server-configured Fast, Deep, and Research model profiles without accepting arbitrary browser-supplied model IDs.", implemented: true, minimumPlan: "top" }),
  connected_apps: Object.freeze({ label: "Connected apps", description: "Permission-based external-service connections with encrypted server-side credentials, explicit authorization, and user-controlled disconnect/revocation.", implemented: true, minimumPlan: "top" }),
  command_center: Object.freeze({ label: "UNBOUND Command Center", description: "Central view of account access, usage, costs, security, platform status, and product controls.", implemented: true, minimumPlan: "top" })
});

function normalizePlanTier(value) {
  return String(value || "").trim().toLowerCase() === "top" ? "top" : "free";
}
function getPlanDefinition(value) { return PLAN_DEFINITIONS[normalizePlanTier(value)]; }
function isKnownCapability(value) { return Object.prototype.hasOwnProperty.call(CAPABILITY_CATALOG, String(value || "").trim()); }
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
    return { key, label: capability.label, description: capability.description, entitled, available, usable: entitled && available, source: override ? "override" : "plan", minimumPlan: minimumPlan.id };
  });
}

module.exports = { PLAN_DEFINITIONS, CAPABILITY_CATALOG, normalizePlanTier, getPlanDefinition, isKnownCapability, buildCapabilityAccess };
