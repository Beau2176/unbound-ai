const crypto = require("crypto");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function cleanOrigin(value) {
  if (!value) return null;
  try {
    return new URL(String(value).trim()).origin.toLowerCase();
  } catch (_) {
    return null;
  }
}

function forwardedProtocol(req, isProduction) {
  const forwarded = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (forwarded === "http" || forwarded === "https") return forwarded;
  if (isProduction) return "https";
  return String(req?.protocol || "http").toLowerCase() === "https" ? "https" : "http";
}

function inferredRequestOrigin(req, isProduction) {
  const host = String(req?.headers?.host || "").trim().toLowerCase();
  if (!host) return null;
  return `${forwardedProtocol(req, isProduction)}://${host}`;
}

function buildContentSecurityPolicy({ isProduction = false } = {}) {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'"
  ];
  if (isProduction) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

function createHttpSecurityMiddleware({ isProduction = false } = {}) {
  const csp = buildContentSecurityPolicy({ isProduction });

  return function unboundHttpSecurity(req, res, next) {
    const requestId = crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Origin-Agent-Cluster", "?1");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), camera=(self), microphone=(self), payment=(), usb=(), serial=()"
    );
    res.setHeader("Content-Security-Policy", csp);

    if (isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }

    if (String(req.path || req.url || "").startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
    }

    next();
  };
}

function isStateChangingApiRequest(req) {
  const method = String(req?.method || "GET").toUpperCase();
  const path = String(req?.path || req?.url || "");
  return path.startsWith("/api/") && !SAFE_METHODS.has(method);
}

function isOriginAllowed(req, {
  isProduction = false,
  publicOrigin = "",
  exemptPaths = []
} = {}) {
  if (!isStateChangingApiRequest(req)) return true;

  const path = String(req?.path || req?.url || "").split("?")[0];
  if (exemptPaths.includes(path)) return true;

  const fetchSite = String(req?.headers?.["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;

  const suppliedOrigin = cleanOrigin(req?.headers?.origin);
  if (!req?.headers?.origin) {
    // Non-browser clients often omit Origin. Cross-site browsers are rejected
    // above through Sec-Fetch-Site; requests with an explicit Origin are
    // compared below.
    return true;
  }
  if (!suppliedOrigin) return false;

  const allowedOrigins = new Set();
  const configuredOrigin = cleanOrigin(publicOrigin);
  if (configuredOrigin) allowedOrigins.add(configuredOrigin);

  const inferredOrigin = cleanOrigin(inferredRequestOrigin(req, isProduction));
  if (inferredOrigin) allowedOrigins.add(inferredOrigin);

  return allowedOrigins.has(suppliedOrigin);
}

function createSameOriginApiGuard(options = {}) {
  return function unboundSameOriginGuard(req, res, next) {
    if (isOriginAllowed(req, options)) return next();

    return res.status(403).json({
      error: "Cross-site state-changing requests are not allowed.",
      requestId: req.requestId || null
    });
  };
}

function getHttpSecurityStatus({ isProduction = false, publicOrigin = "" } = {}) {
  return {
    requestIds: true,
    apiNoStore: true,
    clickjackingProtection: true,
    sameOriginMutationGuard: true,
    hsts: Boolean(isProduction),
    publicOriginConfigured: Boolean(cleanOrigin(publicOrigin))
  };
}

module.exports = {
  buildContentSecurityPolicy,
  createHttpSecurityMiddleware,
  createSameOriginApiGuard,
  getHttpSecurityStatus,
  isOriginAllowed,
  isStateChangingApiRequest
};
