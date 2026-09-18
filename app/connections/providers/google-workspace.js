const crypto = require("crypto");
const { getTokenVaultStatus } = require("../token-vault");

const PROVIDER_ID = "google_workspace";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_API_ORIGIN = "https://gmail.googleapis.com/gmail/v1";
const CALENDAR_API_ORIGIN = "https://www.googleapis.com/calendar/v3";
const DRIVE_API_ORIGIN = "https://www.googleapis.com/drive/v3";
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_GMAIL_MESSAGES = 25;
const MAX_CALENDAR_EVENTS = 50;
const MAX_DRIVE_FILES = 50;

const READ_ONLY_SCOPES = Object.freeze([
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.metadata",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly"
]);

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function safeText(value, maxLength = 500) {
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
    const error = new Error("Google Workspace PKCE code verifier is invalid.");
    error.code = "GOOGLE_WORKSPACE_PKCE_VERIFIER_INVALID";
    throw error;
  }
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function getGoogleWorkspaceConfig(env = process.env) {
  const clientId = safeText(env.GOOGLE_OAUTH_CLIENT_ID, 500);
  const clientSecret = safeText(env.GOOGLE_OAUTH_CLIENT_SECRET, 1000);
  const callbackUrl = cleanHttpsUrl(env.GOOGLE_OAUTH_CALLBACK_URL);
  const appRegistrationVerified = truthy(env.GOOGLE_OAUTH_REGISTRATION_VERIFIED);
  const readOnlyScopesVerified = truthy(env.GOOGLE_OAUTH_READ_ONLY_SCOPES_VERIFIED);
  const tokenVault = getTokenVaultStatus(env);
  const configured = Boolean(
    clientId &&
    clientSecret &&
    callbackUrl &&
    appRegistrationVerified &&
    readOnlyScopesVerified &&
    tokenVault.configured
  );
  return {
    clientId,
    clientSecret,
    callbackUrl,
    appRegistrationVerified,
    readOnlyScopesVerified,
    tokenVaultConfigured: tokenVault.configured,
    configured
  };
}

function publicGoogleWorkspaceStatus(env = process.env) {
  const config = getGoogleWorkspaceConfig(env);
  return {
    provider: PROVIDER_ID,
    configured: config.configured,
    appRegistrationVerified: config.appRegistrationVerified,
    readOnlyScopesVerified: config.readOnlyScopesVerified,
    tokenEncryptionConfigured: config.tokenVaultConfigured,
    authorizationFlow: "web-application-pkce-offline",
    metadataOnly: true,
    gmail: "metadata",
    calendar: "events-readonly",
    drive: "metadata-readonly",
    writeActionsEnabled: false
  };
}

function assertConfigured(env = process.env) {
  if (!getGoogleWorkspaceConfig(env).configured) {
    const error = new Error("Google Workspace Connected Apps is not fully configured.");
    error.code = "GOOGLE_WORKSPACE_CONNECTION_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }
}

function buildAuthorizationUrl({ state, codeChallenge, env = process.env } = {}) {
  assertConfigured(env);
  const normalizedState = safeText(state, 200);
  const challenge = safeText(codeChallenge, 200);
  if (!normalizedState || !/^[A-Za-z0-9_-]{32,200}$/.test(normalizedState)) {
    const error = new Error("Google Workspace authorization state is invalid.");
    error.code = "GOOGLE_WORKSPACE_AUTH_STATE_INVALID";
    throw error;
  }
  if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    const error = new Error("Google Workspace PKCE code challenge is invalid.");
    error.code = "GOOGLE_WORKSPACE_PKCE_CHALLENGE_INVALID";
    throw error;
  }

  const config = getGoogleWorkspaceConfig(env);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", READ_ONLY_SCOPES.join(" "));
  url.searchParams.set("state", normalizedState);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function fetchWithTimeout(url, options = {}, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal, redirect: "error" });
  } catch (cause) {
    const error = new Error("Google Workspace request failed.");
    error.code = cause?.name === "AbortError"
      ? "GOOGLE_WORKSPACE_REQUEST_TIMEOUT"
      : "GOOGLE_WORKSPACE_REQUEST_FAILED";
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response, errorCode) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      String(payload?.error?.message || payload?.error_description || "Google Workspace rejected the request.").slice(0, 1000)
    );
    error.code = errorCode;
    error.statusCode = response.status;
    throw error;
  }
  return payload && typeof payload === "object" ? payload : {};
}

function normalizeTokenPayload(payload = {}, { fallbackRefreshToken = null } = {}) {
  const accessToken = safeText(payload.access_token, 4000);
  if (!accessToken) {
    const error = new Error("Google Workspace token response was invalid.");
    error.code = "GOOGLE_WORKSPACE_TOKEN_RESPONSE_INVALID";
    throw error;
  }
  const expiresIn = Number(payload.expires_in);
  return {
    accessToken,
    refreshToken: safeText(payload.refresh_token, 4000) || safeText(fallbackRefreshToken, 4000),
    tokenType: safeText(payload.token_type, 80) || "Bearer",
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
    refreshTokenExpiresAt: null
  };
}

async function exchangeAuthorizationCode({
  code,
  codeVerifier,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  assertConfigured(env);
  const normalizedCode = safeText(code, 2000);
  const verifier = normalizeCodeVerifier(codeVerifier);
  if (!normalizedCode) {
    const error = new Error("Google Workspace authorization code is invalid.");
    error.code = "GOOGLE_WORKSPACE_AUTH_CODE_INVALID";
    throw error;
  }
  if (!verifier) {
    const error = new Error("Google Workspace PKCE code verifier is invalid.");
    error.code = "GOOGLE_WORKSPACE_PKCE_VERIFIER_INVALID";
    throw error;
  }

  const config = getGoogleWorkspaceConfig(env);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: normalizedCode,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: config.callbackUrl
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
    await readJsonResponse(response, "GOOGLE_WORKSPACE_TOKEN_EXCHANGE_FAILED")
  );
}

async function refreshUserToken({
  refreshToken,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  assertConfigured(env);
  const token = safeText(refreshToken, 4000);
  if (!token) {
    const error = new Error("Google Workspace refresh token is missing.");
    error.code = "GOOGLE_WORKSPACE_REFRESH_TOKEN_MISSING";
    throw error;
  }
  const config = getGoogleWorkspaceConfig(env);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
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
    await readJsonResponse(response, "GOOGLE_WORKSPACE_TOKEN_REFRESH_FAILED"),
    { fallbackRefreshToken: token }
  );
}

async function revokeUserToken({ accessToken, fetchImpl = fetch } = {}) {
  const token = safeText(accessToken, 4000);
  if (!token) return { revoked: false, reason: "token-missing" };
  const response = await fetchWithTimeout(
    REVOKE_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ token }).toString()
    },
    { fetchImpl }
  );
  if (response.status === 200) return { revoked: true };
  const error = new Error("Google Workspace token revocation failed.");
  error.code = "GOOGLE_WORKSPACE_TOKEN_REVOCATION_FAILED";
  error.statusCode = response.status;
  throw error;
}

function bearerHeaders(accessToken) {
  const token = safeText(accessToken, 4000);
  if (!token) {
    const error = new Error("Google Workspace access token is missing.");
    error.code = "GOOGLE_WORKSPACE_ACCESS_TOKEN_MISSING";
    throw error;
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "UNBOUND-AI-Connected-Apps"
  };
}

async function getAuthenticatedUser({ accessToken, fetchImpl = fetch } = {}) {
  const response = await fetchWithTimeout(
    USERINFO_URL,
    { headers: bearerHeaders(accessToken) },
    { fetchImpl }
  );
  const user = await readJsonResponse(response, "GOOGLE_WORKSPACE_USER_LOOKUP_FAILED");
  const id = safeText(user.sub, 300);
  const email = safeText(user.email, 500);
  if (!id || !email) {
    const error = new Error("Google Workspace user response was invalid.");
    error.code = "GOOGLE_WORKSPACE_USER_RESPONSE_INVALID";
    throw error;
  }
  return {
    id,
    login: email,
    name: safeText(user.name, 500),
    picture: cleanHttpsUrl(user.picture),
    hostedDomain: safeText(user.hd, 300)
  };
}

function headerValue(headers, name) {
  const target = String(name || "").toLowerCase();
  const found = (Array.isArray(headers) ? headers : []).find(
    (item) => String(item?.name || "").toLowerCase() === target
  );
  return safeText(found?.value, 2000);
}

async function listGmailMetadata({
  accessToken,
  query = "",
  fetchImpl = fetch
} = {}) {
  const params = new URLSearchParams({
    maxResults: String(MAX_GMAIL_MESSAGES)
  });
  const normalizedQuery = safeText(query, 500);
  if (normalizedQuery) params.set("q", normalizedQuery);

  const listResponse = await fetchWithTimeout(
    `${GMAIL_API_ORIGIN}/users/me/messages?${params.toString()}`,
    { headers: bearerHeaders(accessToken) },
    { fetchImpl }
  );
  const list = await readJsonResponse(listResponse, "GOOGLE_WORKSPACE_GMAIL_LIST_FAILED");
  const ids = (Array.isArray(list.messages) ? list.messages : [])
    .map((item) => safeText(item?.id, 300))
    .filter(Boolean)
    .slice(0, MAX_GMAIL_MESSAGES);

  const messages = [];
  for (const id of ids) {
    const detail = new URLSearchParams({ format: "metadata" });
    for (const header of ["From", "To", "Subject", "Date"]) {
      detail.append("metadataHeaders", header);
    }
    const response = await fetchWithTimeout(
      `${GMAIL_API_ORIGIN}/users/me/messages/${encodeURIComponent(id)}?${detail.toString()}`,
      { headers: bearerHeaders(accessToken) },
      { fetchImpl }
    );
    const message = await readJsonResponse(response, "GOOGLE_WORKSPACE_GMAIL_MESSAGE_FAILED");
    messages.push({
      id: safeText(message.id, 300),
      threadId: safeText(message.threadId, 300),
      labelIds: Array.isArray(message.labelIds)
        ? message.labelIds.slice(0, 50).map((item) => String(item).slice(0, 100))
        : [],
      from: headerValue(message?.payload?.headers, "From"),
      to: headerValue(message?.payload?.headers, "To"),
      subject: headerValue(message?.payload?.headers, "Subject"),
      date: headerValue(message?.payload?.headers, "Date")
    });
  }

  return {
    messages,
    nextPageToken: safeText(list.nextPageToken, 1000),
    resultSizeEstimate: Number(list.resultSizeEstimate || messages.length)
  };
}

function safeIsoTime(value, fallback) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

async function listCalendarEvents({
  accessToken,
  timeMin = null,
  fetchImpl = fetch
} = {}) {
  const params = new URLSearchParams({
    maxResults: String(MAX_CALENDAR_EVENTS),
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: safeIsoTime(timeMin, new Date().toISOString())
  });
  const response = await fetchWithTimeout(
    `${CALENDAR_API_ORIGIN}/calendars/primary/events?${params.toString()}`,
    { headers: bearerHeaders(accessToken) },
    { fetchImpl }
  );
  const payload = await readJsonResponse(response, "GOOGLE_WORKSPACE_CALENDAR_LIST_FAILED");
  const items = (Array.isArray(payload.items) ? payload.items : [])
    .slice(0, MAX_CALENDAR_EVENTS)
    .map((item) => ({
      id: safeText(item?.id, 500),
      status: safeText(item?.status, 100),
      summary: safeText(item?.summary, 2000),
      location: safeText(item?.location, 2000),
      start: safeText(item?.start?.dateTime || item?.start?.date, 100),
      end: safeText(item?.end?.dateTime || item?.end?.date, 100),
      htmlLink: cleanHttpsUrl(item?.htmlLink),
      eventType: safeText(item?.eventType, 100)
    }))
    .filter((item) => item.id);
  return {
    events: items,
    nextPageToken: safeText(payload.nextPageToken, 1000)
  };
}

async function listDriveMetadata({
  accessToken,
  query = "",
  fetchImpl = fetch
} = {}) {
  const normalizedQuery = safeText(query, 500);
  const q = normalizedQuery
    ? `trashed = false and name contains '${normalizedQuery.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
    : "trashed = false";
  const params = new URLSearchParams({
    pageSize: String(MAX_DRIVE_FILES),
    orderBy: "modifiedTime desc",
    q,
    fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))"
  });
  const response = await fetchWithTimeout(
    `${DRIVE_API_ORIGIN}/files?${params.toString()}`,
    { headers: bearerHeaders(accessToken) },
    { fetchImpl }
  );
  const payload = await readJsonResponse(response, "GOOGLE_WORKSPACE_DRIVE_LIST_FAILED");
  const files = (Array.isArray(payload.files) ? payload.files : [])
    .slice(0, MAX_DRIVE_FILES)
    .map((item) => ({
      id: safeText(item?.id, 500),
      name: safeText(item?.name, 1000),
      mimeType: safeText(item?.mimeType, 300),
      modifiedTime: safeText(item?.modifiedTime, 100),
      webViewLink: cleanHttpsUrl(item?.webViewLink),
      owners: Array.isArray(item?.owners)
        ? item.owners.slice(0, 20).map((owner) => ({
            displayName: safeText(owner?.displayName, 500),
            emailAddress: safeText(owner?.emailAddress, 500)
          }))
        : []
    }))
    .filter((item) => item.id);
  return {
    files,
    nextPageToken: safeText(payload.nextPageToken, 1000)
  };
}

module.exports = {
  PROVIDER_ID,
  AUTHORIZE_URL,
  TOKEN_URL,
  REVOKE_URL,
  USERINFO_URL,
  GMAIL_API_ORIGIN,
  CALENDAR_API_ORIGIN,
  DRIVE_API_ORIGIN,
  READ_ONLY_SCOPES,
  MAX_GMAIL_MESSAGES,
  MAX_CALENDAR_EVENTS,
  MAX_DRIVE_FILES,
  normalizeCodeVerifier,
  createPkceChallenge,
  getGoogleWorkspaceConfig,
  publicGoogleWorkspaceStatus,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshUserToken,
  revokeUserToken,
  getAuthenticatedUser,
  listGmailMetadata,
  listCalendarEvents,
  listDriveMetadata
};
