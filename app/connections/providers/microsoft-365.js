const crypto = require("crypto");
const { getTokenVaultStatus } = require("../token-vault");

const PROVIDER_ID = "microsoft_365";
const IDENTITY_ORIGIN = "https://login.microsoftonline.com";
const GRAPH_ORIGIN = "https://graph.microsoft.com/v1.0";
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_MAIL_MESSAGES = 25;
const MAX_CALENDAR_EVENTS = 50;
const MAX_DRIVE_ITEMS = 50;

const READ_ONLY_SCOPES = Object.freeze([
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.ReadBasic",
  "https://graph.microsoft.com/Calendars.ReadBasic",
  "https://graph.microsoft.com/Files.Read"
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

function normalizeTenant(value) {
  const text = String(value || "common").trim();
  if (["common", "organizations", "consumers"].includes(text)) return text;
  return /^[A-Za-z0-9.-]{1,200}$/.test(text) ? text : null;
}

function normalizeCodeVerifier(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9._~-]{43,128}$/.test(text) ? text : null;
}

function createPkceChallenge(codeVerifier) {
  const verifier = normalizeCodeVerifier(codeVerifier);
  if (!verifier) {
    const error = new Error("Microsoft 365 PKCE code verifier is invalid.");
    error.code = "MICROSOFT_365_PKCE_VERIFIER_INVALID";
    throw error;
  }
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function getMicrosoft365Config(env = process.env) {
  const clientId = safeText(env.MICROSOFT_OAUTH_CLIENT_ID, 500);
  const clientSecret = safeText(env.MICROSOFT_OAUTH_CLIENT_SECRET, 2000);
  const callbackUrl = cleanHttpsUrl(env.MICROSOFT_OAUTH_CALLBACK_URL);
  const tenant = normalizeTenant(env.MICROSOFT_OAUTH_TENANT || "common");
  const appRegistrationVerified = truthy(env.MICROSOFT_OAUTH_REGISTRATION_VERIFIED);
  const readOnlyScopesVerified = truthy(env.MICROSOFT_OAUTH_READ_ONLY_SCOPES_VERIFIED);
  const fileReadScopeVerified = truthy(env.MICROSOFT_OAUTH_FILE_READ_SCOPE_VERIFIED);
  const tokenVault = getTokenVaultStatus(env);
  const configured = Boolean(
    clientId &&
    clientSecret &&
    callbackUrl &&
    tenant &&
    appRegistrationVerified &&
    readOnlyScopesVerified &&
    fileReadScopeVerified &&
    tokenVault.configured
  );
  return {
    clientId,
    clientSecret,
    callbackUrl,
    tenant,
    appRegistrationVerified,
    readOnlyScopesVerified,
    fileReadScopeVerified,
    tokenVaultConfigured: tokenVault.configured,
    configured
  };
}

function publicMicrosoft365Status(env = process.env) {
  const config = getMicrosoft365Config(env);
  return {
    provider: PROVIDER_ID,
    configured: config.configured,
    tenant: config.tenant || "common",
    appRegistrationVerified: config.appRegistrationVerified,
    readOnlyScopesVerified: config.readOnlyScopesVerified,
    fileReadScopeVerified: config.fileReadScopeVerified,
    tokenEncryptionConfigured: config.tokenVaultConfigured,
    authorizationFlow: "oauth2-v2-confidential-web-pkce",
    mail: "Mail.ReadBasic",
    calendar: "Calendars.ReadBasic",
    files: "Files.Read",
    mailBodyAccessRequested: false,
    calendarBodyAccessRequested: false,
    oneDriveContentEndpointEnabled: false,
    writeActionsEnabled: false
  };
}

function assertConfigured(env = process.env) {
  if (!getMicrosoft365Config(env).configured) {
    const error = new Error("Microsoft 365 Connected Apps is not fully configured.");
    error.code = "MICROSOFT_365_CONNECTION_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }
}

function authorizationEndpoint(env = process.env) {
  const tenant = getMicrosoft365Config(env).tenant || "common";
  return `${IDENTITY_ORIGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;
}

function tokenEndpoint(env = process.env) {
  const tenant = getMicrosoft365Config(env).tenant || "common";
  return `${IDENTITY_ORIGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
}

function buildAuthorizationUrl({ state, codeChallenge, env = process.env } = {}) {
  assertConfigured(env);
  const normalizedState = safeText(state, 200);
  const challenge = safeText(codeChallenge, 200);
  if (!normalizedState || !/^[A-Za-z0-9_-]{32,200}$/.test(normalizedState)) {
    const error = new Error("Microsoft 365 authorization state is invalid.");
    error.code = "MICROSOFT_365_AUTH_STATE_INVALID";
    throw error;
  }
  if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    const error = new Error("Microsoft 365 PKCE code challenge is invalid.");
    error.code = "MICROSOFT_365_PKCE_CHALLENGE_INVALID";
    throw error;
  }
  const config = getMicrosoft365Config(env);
  const url = new URL(authorizationEndpoint(env));
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", READ_ONLY_SCOPES.join(" "));
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
    const error = new Error("Microsoft 365 request failed.");
    error.code = cause?.name === "AbortError"
      ? "MICROSOFT_365_REQUEST_TIMEOUT"
      : "MICROSOFT_365_REQUEST_FAILED";
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response, errorCode) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    const message = safeText(
      payload?.error_description ||
      payload?.error?.message ||
      payload?.error ||
      "Microsoft rejected the request.",
      500
    );
    const error = new Error(message || "Microsoft rejected the request.");
    error.code = errorCode;
    error.statusCode = Number(response.status) || 502;
    throw error;
  }
  return payload;
}

function normalizeTokenPayload(payload = {}, { previousRefreshToken = null } = {}) {
  const accessToken = safeText(payload.access_token, 10000);
  const refreshToken = safeText(payload.refresh_token, 10000) || safeText(previousRefreshToken, 10000);
  if (!accessToken) {
    const error = new Error("Microsoft 365 token response was invalid.");
    error.code = "MICROSOFT_365_TOKEN_RESPONSE_INVALID";
    throw error;
  }
  const expiresIn = Number(payload.expires_in);
  return {
    accessToken,
    refreshToken,
    tokenType: safeText(payload.token_type, 80) || "Bearer",
    scope: safeText(payload.scope, 5000),
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
  const normalizedCode = safeText(code, 5000);
  const verifier = normalizeCodeVerifier(codeVerifier);
  if (!normalizedCode) {
    const error = new Error("Microsoft 365 authorization code is invalid.");
    error.code = "MICROSOFT_365_AUTH_CODE_INVALID";
    throw error;
  }
  if (!verifier) {
    const error = new Error("Microsoft 365 PKCE code verifier is invalid.");
    error.code = "MICROSOFT_365_PKCE_VERIFIER_INVALID";
    throw error;
  }
  const config = getMicrosoft365Config(env);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: normalizedCode,
    redirect_uri: config.callbackUrl,
    grant_type: "authorization_code",
    code_verifier: verifier,
    scope: READ_ONLY_SCOPES.join(" ")
  });
  const response = await fetchWithTimeout(
    tokenEndpoint(env),
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
    await readJsonResponse(response, "MICROSOFT_365_TOKEN_EXCHANGE_FAILED")
  );
}

async function refreshUserToken({
  refreshToken,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  assertConfigured(env);
  const token = safeText(refreshToken, 10000);
  if (!token) {
    const error = new Error("Microsoft 365 refresh token is missing.");
    error.code = "MICROSOFT_365_REFRESH_TOKEN_MISSING";
    throw error;
  }
  const config = getMicrosoft365Config(env);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: token,
    scope: READ_ONLY_SCOPES.join(" ")
  });
  const response = await fetchWithTimeout(
    tokenEndpoint(env),
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
    await readJsonResponse(response, "MICROSOFT_365_TOKEN_REFRESH_FAILED"),
    { previousRefreshToken: token }
  );
}

function bearerHeaders(accessToken) {
  const token = safeText(accessToken, 10000);
  if (!token) {
    const error = new Error("Microsoft 365 access token is missing.");
    error.code = "MICROSOFT_365_ACCESS_TOKEN_MISSING";
    throw error;
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "UNBOUND-AI-Connected-Apps"
  };
}

async function graphGet(pathname, {
  accessToken,
  searchParams = null,
  fetchImpl = fetch,
  errorCode = "MICROSOFT_365_GRAPH_REQUEST_FAILED"
} = {}) {
  const url = new URL(GRAPH_ORIGIN + pathname);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const response = await fetchWithTimeout(
    url.toString(),
    { headers: bearerHeaders(accessToken) },
    { fetchImpl }
  );
  return readJsonResponse(response, errorCode);
}

function emailAddress(value) {
  return safeText(value?.emailAddress?.address, 1000);
}

async function getAuthenticatedUser({ accessToken, fetchImpl = fetch } = {}) {
  const payload = await graphGet("/me", {
    accessToken,
    searchParams: {
      "$select": "id,displayName,mail,userPrincipalName"
    },
    fetchImpl,
    errorCode: "MICROSOFT_365_USERINFO_FAILED"
  });
  const id = safeText(payload.id, 500);
  const login = safeText(payload.mail, 1000) ||
    safeText(payload.userPrincipalName, 1000) ||
    safeText(payload.displayName, 1000);
  if (!id || !login) {
    const error = new Error("Microsoft 365 user identity response was invalid.");
    error.code = "MICROSOFT_365_USER_RESPONSE_INVALID";
    throw error;
  }
  return {
    id,
    login,
    displayName: safeText(payload.displayName, 1000),
    mail: safeText(payload.mail, 1000),
    userPrincipalName: safeText(payload.userPrincipalName, 1000)
  };
}

async function listMailMetadata({ accessToken, fetchImpl = fetch } = {}) {
  const payload = await graphGet("/me/messages", {
    accessToken,
    searchParams: {
      "$top": MAX_MAIL_MESSAGES,
      "$select": "id,subject,from,toRecipients,receivedDateTime,isRead,webLink",
      "$orderby": "receivedDateTime desc"
    },
    fetchImpl,
    errorCode: "MICROSOFT_365_MAIL_LIST_FAILED"
  });
  const messages = (Array.isArray(payload.value) ? payload.value : [])
    .slice(0, MAX_MAIL_MESSAGES)
    .map((message) => ({
      id: safeText(message?.id, 1000),
      subject: safeText(message?.subject, 2000),
      from: emailAddress(message?.from),
      to: Array.isArray(message?.toRecipients)
        ? message.toRecipients.map(emailAddress).filter(Boolean).slice(0, 20)
        : [],
      receivedDateTime: safeText(message?.receivedDateTime, 100),
      isRead: Boolean(message?.isRead),
      webLink: cleanHttpsUrl(message?.webLink)
    }))
    .filter((message) => message.id);
  return { messages };
}

function normalizeIso(value, fallback) {
  const date = value ? new Date(value) : fallback;
  return Number.isFinite(date?.getTime?.()) ? date.toISOString() : fallback.toISOString();
}

async function listCalendarEvents({
  accessToken,
  startDateTime,
  endDateTime,
  fetchImpl = fetch
} = {}) {
  const startDefault = new Date();
  const endDefault = new Date(startDefault.getTime() + 30 * 24 * 60 * 60 * 1000);
  const start = normalizeIso(startDateTime, startDefault);
  const end = normalizeIso(endDateTime, endDefault);
  const payload = await graphGet("/me/calendarView", {
    accessToken,
    searchParams: {
      startDateTime: start,
      endDateTime: end,
      "$top": MAX_CALENDAR_EVENTS,
      "$select": "id,subject,start,end,location,webLink,isAllDay",
      "$orderby": "start/dateTime"
    },
    fetchImpl,
    errorCode: "MICROSOFT_365_CALENDAR_LIST_FAILED"
  });
  const events = (Array.isArray(payload.value) ? payload.value : [])
    .slice(0, MAX_CALENDAR_EVENTS)
    .map((event) => ({
      id: safeText(event?.id, 1000),
      subject: safeText(event?.subject, 2000),
      start: safeText(event?.start?.dateTime, 100),
      startTimeZone: safeText(event?.start?.timeZone, 200),
      end: safeText(event?.end?.dateTime, 100),
      endTimeZone: safeText(event?.end?.timeZone, 200),
      location: safeText(event?.location?.displayName, 1000),
      isAllDay: Boolean(event?.isAllDay),
      webLink: cleanHttpsUrl(event?.webLink)
    }))
    .filter((event) => event.id);
  return { startDateTime: start, endDateTime: end, events };
}

async function listOneDriveMetadata({ accessToken, fetchImpl = fetch } = {}) {
  const payload = await graphGet("/me/drive/root/children", {
    accessToken,
    searchParams: {
      "$top": MAX_DRIVE_ITEMS,
      "$select": "id,name,size,lastModifiedDateTime,webUrl,file,folder,parentReference"
    },
    fetchImpl,
    errorCode: "MICROSOFT_365_DRIVE_LIST_FAILED"
  });
  const items = (Array.isArray(payload.value) ? payload.value : [])
    .slice(0, MAX_DRIVE_ITEMS)
    .map((item) => ({
      id: safeText(item?.id, 1000),
      name: safeText(item?.name, 2000),
      size: Number.isFinite(Number(item?.size)) ? Number(item.size) : null,
      lastModifiedDateTime: safeText(item?.lastModifiedDateTime, 100),
      webUrl: cleanHttpsUrl(item?.webUrl),
      mimeType: safeText(item?.file?.mimeType, 500),
      isFile: Boolean(item?.file),
      isFolder: Boolean(item?.folder),
      childCount: Number.isFinite(Number(item?.folder?.childCount))
        ? Number(item.folder.childCount)
        : null,
      parentPath: safeText(item?.parentReference?.path, 2000)
    }))
    .filter((item) => item.id && item.name);
  return { items };
}

module.exports = {
  PROVIDER_ID,
  IDENTITY_ORIGIN,
  GRAPH_ORIGIN,
  READ_ONLY_SCOPES,
  MAX_MAIL_MESSAGES,
  MAX_CALENDAR_EVENTS,
  MAX_DRIVE_ITEMS,
  normalizeTenant,
  normalizeCodeVerifier,
  createPkceChallenge,
  getMicrosoft365Config,
  publicMicrosoft365Status,
  authorizationEndpoint,
  tokenEndpoint,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshUserToken,
  getAuthenticatedUser,
  listMailMetadata,
  listCalendarEvents,
  listOneDriveMetadata
};
