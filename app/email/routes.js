const path = require("path");
const express = require("express");
const defaultService = require("./service");

function noopMiddleware(_req, _res, next) {
  next();
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function errorResponse(error) {
  switch (error?.code) {
    case "EMAIL_PROVIDER_NOT_CONFIGURED":
    case "EMAIL_VERIFICATION_ORIGIN_INVALID":
    case "EMAIL_VERIFICATION_SECRET_MISSING":
      return { status: 503, message: "Email verification is temporarily unavailable." };
    case "EMAIL_VERIFICATION_DELIVERY_FAILED":
      return { status: 502, message: "Verification email could not be sent." };
    case "EMAIL_VERIFICATION_TOKEN_REQUIRED":
      return { status: 400, message: "Verification link is invalid or expired." };
    case "EMAIL_VERIFICATION_USER_REQUIRED":
      return { status: 401, message: "Sign in to verify your account email." };
    case "EMAIL_VERIFICATION_EMAIL_INVALID":
      return { status: 400, message: "The account email address cannot be verified." };
    default:
      return { status: 500, message: "Email verification failed." };
  }
}

function createEmailVerificationHandlers({
  getPool,
  findSessionUser,
  verificationService = defaultService,
  env = process.env
} = {}) {
  if (typeof getPool !== "function") {
    throw new TypeError("getPool() is required for email verification routes.");
  }
  if (typeof findSessionUser !== "function") {
    throw new TypeError("findSessionUser(req) is required for email verification routes.");
  }

  function requirePool(res) {
    const pool = getPool();
    if (!pool) {
      sendError(res, 503, "Email verification is temporarily unavailable.");
      return null;
    }
    return pool;
  }

  async function signedInUser(req, res) {
    const user = await findSessionUser(req);
    if (!user) {
      sendError(res, 401, "Sign in to manage account email verification.");
      return null;
    }
    return user;
  }

  async function status(req, res) {
    try {
      const pool = requirePool(res);
      if (!pool) return;
      const user = await signedInUser(req, res);
      if (!user) return;

      const result = await verificationService.getStatus({
        pool,
        userId: user.id,
        env
      });
      return res.json({ verification: result });
    } catch (error) {
      const response = errorResponse(error);
      return sendError(res, response.status, response.message);
    }
  }

  async function send(req, res) {
    try {
      const pool = requirePool(res);
      if (!pool) return;
      const user = await signedInUser(req, res);
      if (!user) return;

      const result = await verificationService.send({ pool, user, env });
      return res.json({ verification: result });
    } catch (error) {
      const response = errorResponse(error);
      return sendError(res, response.status, response.message);
    }
  }

  async function resend(req, res) {
    try {
      const pool = requirePool(res);
      if (!pool) return;
      const user = await signedInUser(req, res);
      if (!user) return;

      const result = await verificationService.resend({ pool, user, env });
      return res.json({ verification: result });
    } catch (error) {
      const response = errorResponse(error);
      return sendError(res, response.status, response.message);
    }
  }

  async function consume(req, res) {
    try {
      const pool = requirePool(res);
      if (!pool) return;

      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!token || token.length > 512) {
        return sendError(res, 400, "Verification link is invalid or expired.");
      }

      const result = await verificationService.consume({ pool, token, env });
      if (!result?.verified) {
        return sendError(res, 400, "Verification link is invalid or expired.");
      }

      return res.json({ verification: { verified: true } });
    } catch (error) {
      const response = errorResponse(error);
      return sendError(res, response.status, response.message);
    }
  }

  return { status, send, resend, consume };
}

function createEmailVerificationRouter({
  getPool,
  findSessionUser,
  verificationService = defaultService,
  env = process.env,
  sendRateLimit = noopMiddleware,
  consumeRateLimit = noopMiddleware
} = {}) {
  const handlers = createEmailVerificationHandlers({
    getPool,
    findSessionUser,
    verificationService,
    env
  });
  const router = express.Router();

  router.get("/status", handlers.status);
  router.post("/send", sendRateLimit, handlers.send);
  router.post("/resend", sendRateLimit, handlers.resend);
  router.post("/consume", consumeRateLimit, handlers.consume);

  return router;
}

function sendEmailVerificationPage(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  return res.sendFile(path.join(__dirname, "..", "verify-email.html"));
}

module.exports = {
  createEmailVerificationHandlers,
  createEmailVerificationRouter,
  sendEmailVerificationPage,
  errorResponse
};
