"use strict";
const { normalizePlanTier, PLAN_DEFINITIONS } = require("./entitlements");
const VERSION = "2026-09-27";
const WINDOWS = Object.freeze({ session: 18000, week: 604800 });
const FEATURES = Object.freeze({ chat: "Chat credits", research: "Web research requests", files: "File analyses", artifacts: "Document creation requests", vision: "Image analyses", images: "Image generation / edits", voice: "Cloud voice replies", agents: "Agent runs" });
// [five-hour, seven-day] allowances: UNBOUND decisions, not competitor quotas.
const LIMITS = Object.freeze({
  free: { chat: [30, 150] },
  premium: { chat: [150, 1000], research: [25, 100], files: [30, 150], artifacts: [20, 100], vision: [30, 150], voice: [200, 1000] },
  ultra: { chat: [400, 2500], research: [75, 300], files: [75, 375], artifacts: [50, 250], vision: [75, 375], images: [20, 100], voice: [500, 2500], agents: [10, 50] },
  max: { chat: [600, 4000], research: [125, 500], files: [120, 600], artifacts: [80, 400], vision: [120, 600], images: [40, 200], voice: [800, 4000], agents: [20, 100] }
});
for (const plan of Object.values(LIMITS)) { for (const pair of Object.values(plan)) Object.freeze(pair); Object.freeze(plan); }
function policiesFor(planTier, charges) {
  const limits = LIMITS[normalizePlanTier(planTier)];
  return Object.entries(charges).flatMap(([feature, units]) => {
    if (!FEATURES[feature] || !Number.isSafeInteger(units) || units < 1) throw new Error("Invalid usage charge");
    const pair = limits[feature] || [0, 0];
    return Object.entries(WINDOWS).map(([window, seconds], i) => ({ scope: `usage:${feature}:${window}`, feature, label: FEATURES[feature], window, windowSeconds: seconds, limit: pair[i], units }));
  });
}
function classifyRequest(req) {
  if (req.method !== "POST") return null;
  const path = String(req.originalUrl || req.url || "").split("?")[0].toLowerCase().replace(/\/+$/, "");
  if (["/api/chat", "/api/chat/stream"].includes(path)) {
    const research = String(req.body?.productMode || "").trim().toLowerCase() === "research";
    const work = String(req.body?.depthStyle || "").trim().toLowerCase() === "work";
    return { chat: work || research ? 3 : 1, ...(research ? { research: 1 } : {}) };
  }
  if (/^\/api\/platform\/coding\/jobs\/[^/]+\/dispatch$/.test(path) || /^\/api\/platform\/mcp\/tools\/[^/]+\/call$/.test(path)) return { agents: 1 };
  const routes = { "/api/future-core-v2/jobs": "agents", "/api/platform/a2a/message": "agents", "/api/file-analysis": "files", "/api/artifacts/plan": "artifacts", "/api/image-understanding": "vision", "/api/image-tools/generate": "images", "/api/image-tools/edit": "images", "/api/voice/speech": "voice", "/api/voice/natural-speech": "voice", "/api/agents/runs": "agents" };
  return routes[path] ? { [routes[path]]: 1 } : null;
}
function publicUsagePolicy() {
  return { version: VERSION, windows: WINDOWS, features: FEATURES, chatCreditCost: { casual: 1, work: 3, research: 3 }, resetRule: "Each window starts with its first admitted request. Five-hour and seven-day limits both apply; upgrading does not reset usage.", countingRule: "HTTP errors return reserved credits. Interrupted streams and failed background jobs may count. Research also uses chat credits. Existing hourly safeguards and feature access rules apply.", plans: Object.entries(PLAN_DEFINITIONS).map(([id, plan]) => ({ ...plan, limits: LIMITS[id] })) };
}
module.exports = { VERSION, WINDOWS, FEATURES, LIMITS, policiesFor, classifyRequest, publicUsagePolicy };
