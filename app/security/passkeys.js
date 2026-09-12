"use strict";

let webAuthnModulePromise = null;

function webAuthnServer() {
  if (!webAuthnModulePromise) {
    webAuthnModulePromise = import("@simplewebauthn/server");
  }
  return webAuthnModulePromise;
}

function parseOrigin(value, fallback) {
  const raw = String(value || fallback || "").trim();
  const parsed = new URL(raw);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Passkey origin must use http or https.");
  }
  return parsed.origin;
}

function getPasskeyConfig(env = process.env) {
  const isProduction =
    env.NODE_ENV === "production" || String(env.RENDER || "").toLowerCase() === "true";
  const fallbackOrigin = isProduction
    ? "https://unbound-ai-app.onrender.com"
    : `http://localhost:${env.PORT || 3000}`;
  const primaryOrigin = parseOrigin(
    env.PASSKEY_ORIGIN || env.PUBLIC_APP_ORIGIN,
    fallbackOrigin
  );
  const primaryUrl = new URL(primaryOrigin);
  const rpID = String(env.PASSKEY_RP_ID || primaryUrl.hostname).trim().toLowerCase();
  const configuredOrigins = String(env.PASSKEY_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseOrigin(item));
  const origins = Array.from(new Set([primaryOrigin, ...configuredOrigins]));

  return {
    rpName: String(env.PASSKEY_RP_NAME || "UNBOUND AI").trim().slice(0, 64) || "UNBOUND AI",
    rpID,
    origin: primaryOrigin,
    origins,
    userVerification: "required",
    challengeTtlSeconds: 300,
    maxPasskeysPerAccount: 10
  };
}

function getPasskeyStatus(env = process.env) {
  try {
    const config = getPasskeyConfig(env);
    return {
      enabled: true,
      rpID: config.rpID,
      origin: config.origin,
      allowedOriginCount: config.origins.length,
      userVerification: config.userVerification,
      biometricDataStored: false,
      privateKeysStored: false,
      challengeTtlSeconds: config.challengeTtlSeconds,
      maxPasskeysPerAccount: config.maxPasskeysPerAccount
    };
  } catch (error) {
    return {
      enabled: false,
      error: error.message || "invalid-passkey-configuration",
      biometricDataStored: false,
      privateKeysStored: false
    };
  }
}

async function generateRegistration({ userName, userDisplayName, userID, excludeCredentials = [] }) {
  const config = getPasskeyConfig();
  const { generateRegistrationOptions } = await webAuthnServer();
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName,
    userDisplayName,
    userID,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required"
    },
    excludeCredentials,
    supportedAlgorithmIDs: [-7, -257],
    timeout: 60000
  });
}

async function verifyRegistration({ response, expectedChallenge }) {
  const config = getPasskeyConfig();
  const { verifyRegistrationResponse } = await webAuthnServer();
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.origins,
    expectedRPID: config.rpID,
    requireUserVerification: true
  });
}

async function generateAuthentication() {
  const config = getPasskeyConfig();
  const { generateAuthenticationOptions } = await webAuthnServer();
  return generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: [],
    userVerification: "required",
    timeout: 60000
  });
}

async function verifyAuthentication({ response, expectedChallenge, credential }) {
  const config = getPasskeyConfig();
  const { verifyAuthenticationResponse } = await webAuthnServer();
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: config.origins,
    expectedRPID: config.rpID,
    credential,
    requireUserVerification: true
  });
}

module.exports = {
  getPasskeyConfig,
  getPasskeyStatus,
  generateRegistration,
  verifyRegistration,
  generateAuthentication,
  verifyAuthentication
};
