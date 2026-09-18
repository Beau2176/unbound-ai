const crypto = require("crypto");
const { getTokenVaultStatus } = require("../token-vault");

const PROVIDER_ID = "slack";
const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const API_ORIGIN = "https://slack.com/api";
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_CHANNELS = 100;
const MAX_HISTORY_MESSAGES = 15;
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

const READ_ONLY_SCOPES = Object.freeze([
  "channels:read",
  "channels:history"
]);

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function safeText(value, maxLength = 1000) {
  const text = String(value || "").trim();
  return text && text.length <= maxLength ? text : null;
}

function cleanHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch (_) {
    return null;
  }
}

function normalizeCodeVerifier(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9._~-]{43,128}$/.test(text) ? text : null;
}

function createPkceChallenge(codeVerifier) {
  const verifier = normalizeCodeVerifier(codeVerifier);
  if (!verifier) {
    const error = new Error("Slack PKCE code verifier is invalid.");
    error.code = "SLACK_PKCE_VERIFIER_INVALID";
    throw error;
  }
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function getSlackConfig(env = process.env) {
  const clientId = safeText(env.SLACK_CLIENT_ID, 500);
  const redirectUrl = cleanHttpsUrl(env.SLACK_REDIRECT_URL);
  const appRegistrationVerified = truthy(env.SLACK_APP_REGISTRATION_VERIFIED);
  const pkceEnabledVerified = truthy(env.SLACK_PKCE_ENABLED_VERIFIED);
  const readOnlyScopesVerified = truthy(env.SLACK_READ_ONLY_SCOPES_VERIFIED);
  const tokenRotationVerified = truthy(env.SLACK_TOKEN_ROTATION_VERIFIED);
  const tokenVault = getTokenVaultStatus(env);
  const configured = Boolean(
    clientId &&
    redirectUrl &&
    appRegistrationVerified &&
    pkceEnabledVerified &&
    readOnlyScopesVerified &&
    tokenRotationVerified &&
    tokenVault.configured
  );
  return {
    clientId,
    redirectUrl,
    appRegistrationVerified,
    pkceEnabledVerified,
    readOnlyScopesVerified,
    tokenRotationVerified,
    tokenVaultConfigured: tokenVault.configured,
    configured
  };
}

function publicSlackStatus(env = process.env) {
  const config = getSlackConfig(env);
  return {
    provider: PROVIDER_ID,
    configured: config.configured,
    appRegistrationVerified: config.appRegistrationVerified,
    pkceEnabledVerified: config.pkceEnabledVerified,
    readOnlyScopesVerified: config.readOnlyScopesVerified,
    tokenRotationVerified: config.tokenRotationVerified,
    tokenEncryptionConfigured: config.tokenVaultConfigured,
    authorizationFlow: "oauth-v2-pkce-rotating-bot-token",
    scopes: READ_ONLY_SCOPES,
    channelAccess: "public-channels-app-is-member-of",
    writeActionsEnabled: false
  };
}

function assertConfigured(env = process.env) {
  if (!getSlackConfig(env).configured) {
    const error = new Error("Slack Connected Apps is not fully configured.");
    error.code = "SLACK_CONNECTION_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }
}

function buildAuthorizationUrl({ state, codeChallenge, env = process.env } = {}) {
  assertConfigured(env);
  const normalizedState = safeText(state, 200);
  const challenge = safeText(codeChallenge, 200);
  if (!normalizedState || !/^[A-Za-z0-9_-]{32,200}$/.test(normalizedState)) {
    const error = new Error("Slack authorization state is invalid.");
    error.code = "SLACK_AUTH_STATE_INVALID";
    throw error;
  }
  if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    const error = new Error("Slack PKCE code challenge is invalid.");
    error.code = "SLACK_PKCE_CHALLENGE_INVALID";
    throw error;
  }

  const config = getSlackConfig(env);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUrl);
  url.searchParams.set("scope", READ_ONLY_SCOPES.join(","));
  url.searchParams.set("state", normalizedState);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function fetchWithTimeout(url, options = {}, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal, redirect: "error" });
  } catch (cause) {
    const error = new Error("Slack request failed.");
    error.code = cause?.name === "AbortError" ? "SLACK_REQUEST_TIMEOUT" : "SLACK_REQUEST_FAILED";
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readSlackResponse(response, errorCode) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok !== true) {
    const error = new Error(
      String(payload?.error || "Slack rejected the request.").slice(0, 500)
    );
    error.code = errorCode;
    error.statusCode = response.status || 502;
    throw error;
  }
  return payload;
}

function normalizeTokenPayload(payload = {}, { requireRefreshToken = true } = {}) {
  const accessToken = safeText(payload.access_token, 5000);
  const refreshToken = safeText(payload.refresh_token, 5000);
  if (!accessToken || (requireRefreshToken && !refreshToken)) {
    const error = new Error("Slack rotating token response was invalid.");
    error.code = "SLACK_TOKEN_RESPONSE_INVALID";
    throw error;
  }
  const expiresIn = Number(payload.expires_in);
  const now = Date.now();
  return {
    accessToken,
    refreshToken,
    tokenType: safeText(payload.token_type, 80) || "bot",
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(now + expiresIn * 1000).toISOString()
      : null,
    refreshTokenExpiresAt: refreshToken
      ? new Date(now + REFRESH_TOKEN_LIFETIME_MS).toISOString()
      : null
  };
}

async function exchangeAuthorizationCode({
  code,
  codeVerifier,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  assertConfigured(env);
  const normalizedCode = safeText(code, 3000);
  const verifier = normalizeCodeVerifier(codeVerifier);
  if (!normalizedCode) {
    const error = new Error("Slack authorization code is invalid.");
    error.code = "SLACK_AUTH_CODE_INVALID";
    throw error;
  }
  if (!verifier) {
    const error = new Error("Slack PKCE code verifier is invalid.");
    error.code = "SLACK_PKCE_VERIFIER_INVALID";
    throw error;
  }
  const config = getSlackConfig(env);
  const body = new URLSearchParams({
    client_id: config.clientId,
    code: normalizedCode,
    code_verifier: verifier,
    redirect_uri: config.redirectUrl,
    grant_type: "authorization_code"
  });
  const response = await fetchWithTimeout(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    },
    { fetchImpl }
  );
  const payload = await readSlackResponse(response, "SLACK_TOKEN_EXCHANGE_FAILED");
  return {
    tokens: normalizeTokenPayload(payload),
    installation: {
      teamId: safeText(payload?.team?.id, 300),
      teamName: safeText(payload?.team?.name, 500),
      botUserId: safeText(payload?.bot_user_id, 300),
      appId: safeText(payload?.app_id, 300),
      scopes: safeText(payload?.scope, 3000)
    }
  };
}

async function refreshUserToken({
  refreshToken,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  assertConfigured(env);
  const token = safeText(refreshToken, 5000);
  if (!token) {
    const error = new Error("Slack refresh token is missing.");
    error.code = "SLACK_REFRESH_TOKEN_MISSING";
    throw error;
  }
  const config = getSlackConfig(env);
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: "refresh_token",
    refresh_token: token
  });
  const response = await fetchWithTimeout(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    },
    { fetchImpl }
  );
  return normalizeTokenPayload(
    await readSlackResponse(response, "SLACK_TOKEN_REFRESH_FAILED")
  );
}

function bearerHeaders(accessToken) {
  const token = safeText(accessToken, 5000);
  if (!token) {
    const error = new Error("Slack access token is missing.");
    error.code = "SLACK_ACCESS_TOKEN_MISSING";
    throw error;
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "UNBOUND-AI-Connected-Apps"
  };
}

async function getAuthenticatedWorkspace({ accessToken, fetchImpl = fetch } = {}) {
  const response = await fetchWithTimeout(
    `${API_ORIGIN}/auth.test`,
    {
      method: "POST",
      headers: bearerHeaders(accessToken)
    },
    { fetchImpl }
  );
  const payload = await readSlackResponse(response, "SLACK_AUTH_TEST_FAILED");
  const teamId = safeText(payload.team_id, 300);
  const teamName = safeText(payload.team, 500);
  if (!teamId || !teamName) {
    const error = new Error("Slack workspace identity response was invalid.");
    error.code = "SLACK_WORKSPACE_RESPONSE_INVALID";
    throw error;
  }
  return {
    id: teamId,
    login: teamName,
    userId: safeText(payload.user_id, 300),
    botId: safeText(payload.bot_id, 300),
    url: cleanHttpsUrl(payload.url)
  };
}

async function listPublicChannels({ accessToken, fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    types: "public_channel",
    exclude_archived: "true",
    limit: String(MAX_CHANNELS)
  });
  const response = await fetchWithTimeout(
    `${API_ORIGIN}/conversations.list?${params.toString()}`,
    { headers: bearerHeaders(accessToken) },
    { fetchImpl }
  );
  const payload = await readSlackResponse(response, "SLACK_CHANNEL_LIST_FAILED");
  const channels = (Array.isArray(payload.channels) ? payload.channels : [])
    .slice(0, MAX_CHANNELS)
    .map((channel) => ({
      id: safeText(channel?.id, 300),
      name: safeText(channel?.name, 500),
      isMember: Boolean(channel?.is_member),
      isArchived: Boolean(channel?.is_archived),
      topic: safeText(channel?.topic?.value, 1000),
      purpose: safeText(channel?.purpose?.value, 1000)
    }))
    .filter((channel) => channel.id && channel.name && !channel.isArchived);
  return {
    channels,
    nextCursor: safeText(payload?.response_metadata?.next_cursor, 1000)
  };
}

function validPublicChannelId(value) {
  return /^C[A-Z0-9]{8,30}$/.test(String(value || "").trim());
}

async function listChannelHistory({
  accessToken,
  channelId,
  fetchImpl = fetch
} = {}) {
  if (!validPublicChannelId(channelId)) {
    const error = new Error("Slack public channel ID is invalid.");
    error.code = "SLACK_CHANNEL_ID_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const params = new URLSearchParams({
    channel: String(channelId),
    limit: String(MAX_HISTORY_MESSAGES),
    inclusive: "true"
  });
  const response = await fetchWithTimeout(
    `${API_ORIGIN}/conversations.history?${params.toString()}`,
    { headers: bearerHeaders(accessToken) },
    { fetchImpl }
  );
  const payload = await readSlackResponse(response, "SLACK_CHANNEL_HISTORY_FAILED");
  const messages = (Array.isArray(payload.messages) ? payload.messages : [])
    .slice(0, MAX_HISTORY_MESSAGES)
    .map((message) => ({
      ts: safeText(message?.ts, 100),
      user: safeText(message?.user || message?.bot_id, 300),
      text: safeText(message?.text, 8000),
      threadTs: safeText(message?.thread_ts, 100),
      subtype: safeText(message?.subtype, 100)
    }))
    .filter((message) => message.ts);
  return {
    messages,
    hasMore: Boolean(payload.has_more)
  };
}

async function revokeUserToken({ accessToken, fetchImpl = fetch } = {}) {
  const response = await fetchWithTimeout(
    `${API_ORIGIN}/auth.revoke`,
    {
      method: "POST",
      headers: bearerHeaders(accessToken)
    },
    { fetchImpl }
  );
  const payload = await readSlackResponse(response, "SLACK_TOKEN_REVOCATION_FAILED");
  return { revoked: Boolean(payload.revoked) };
}

module.exports = {
  PROVIDER_ID,
  AUTHORIZE_URL,
  TOKEN_URL,
  API_ORIGIN,
  READ_ONLY_SCOPES,
  MAX_CHANNELS,
  MAX_HISTORY_MESSAGES,
  REFRESH_TOKEN_LIFETIME_MS,
  normalizeCodeVerifier,
  createPkceChallenge,
  getSlackConfig,
  publicSlackStatus,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshUserToken,
  getAuthenticatedWorkspace,
  listPublicChannels,
  validPublicChannelId,
  listChannelHistory,
  revokeUserToken
};
