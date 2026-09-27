"use strict";
const { policiesFor, classifyRequest } = require("./usage-policy");
const { reserveUsage, refundUsage } = require("./usage-store");
function createUsageMiddleware({ getPool, resolveAccount, guestSubject, secret, reserve = reserveUsage, refund = refundUsage }) {
  return async function usageMiddleware(req, res, next) {
    const charges = classifyRequest(req);
    if (!charges) return next();
    try {
      const pool = getPool();
      if (!pool) return res.status(503).json({ error: "Usage tracking is temporarily unavailable. Please try again shortly." });
      const account = await resolveAccount(req);
      const subject = account ? { kind: "account", value: String(account.user.id) } : guestSubject(req, res);
      const policies = policiesFor(account?.tier || "free", charges);
      if (policies.some(p => p.limit === 0)) return res.status(403).json({ error: "This feature is not included in your plan.", code: "PLAN_FEATURE_REQUIRED" });
      if (!policies.length) return next();
      const reservation = await reserve(pool, secret, subject, policies);
      if (!reservation.allowed) {
        res.setHeader("Retry-After", String(reservation.retryAfter));
        return res.status(429).json({ error: "Your usage allowance for this feature has been reached. See Usage & limits for its reset time.", code: "PLAN_USAGE_LIMIT", usage: reservation.blocked, retryAfter: reservation.retryAfter });
      }
      res.setHeader("X-Unbound-Usage-Remaining", String(Math.min(...reservation.windows.map(w => w.remaining))));
      res.once("finish", () => { if (res.statusCode >= 400) refund(pool, reservation).catch(() => console.error("UNBOUND USAGE REFUND FAILED")); });
      return next();
    } catch (_) { return res.status(503).json({ error: "Usage tracking is temporarily unavailable. Please try again shortly." }); }
  };
}
module.exports = { createUsageMiddleware };
