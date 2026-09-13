const crypto = require("crypto");
const { getTokenVaultStatus } = require("../token-vault");

const PROVIDER_ID = "github";
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2026-03-10";
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_REPOSITORIES = 500;

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function safeText(value, maxLength = 300) {
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
    const error = new Error("GitHub PKCE code verifier is invalid.");
    error.code = "GITHUB_PKCE_VERIFIER_INVALID";
    throw error;
  }
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function getGitHubConfig(env = process.env) {
  const clientId = safeText(env.GITHUB_APP_CLIENT_ID, 300);
  const clientSecret = safeText(env.GITHUB_APP_CLIENT_SECRET, 500);
  const callbackUrl = cleanHttpsUrl(env.GITHUB_APP_CALLBACK_URL);
  const appRegistrationVerified = truthy(env.GITHUB_APP_REGISTRATION_VERIFIED);
  const readOnlyPermissionsVerified = truthy(env.GITHUB_APP_READ_ONLY_PERMISSIONS_VERIFIED);
  const tokenVault = getTokenVaultStatus(env);
  const configured = Boolean(
    clientId &&
    clientSecret &&
    callbackUrl &&
    appRegistrationVerified &&
    readOnlyPermissionsVerified &&
    tokenVault.configured
  );

  return {
    clientId,
    clientSecret,
    callbackUrl,
    appRegistrationVerified,
    readOnlyPermissionsVerified,
    tokenVaultConfigured: tokenVault.configured,
    configured
  };
}

function publicGitHubStatus(env = process.env) {
  const config = getGitHubConfig(env);
  return {
    provider: PROVIDER_ID,
    configured: config.configured,
    appRegistrationVerified: config.appRegistrationVerified,
    readOnlyPermissionsVerified: config.readOnlyPermissionsVerified,
    tokenEncryptionConfigured: config.tokenVaultConfigured,
    authorizationFlow: "web-application-pkce",
    apiVersion: API_VERSION,
    writeActionsEnabled: false
  };
}

function assertConfigured(env = process.env) {
  if (!getGitHubConfig(env).configured) {
    const error = new Error("GitHub Connected Apps is not fully configured.");
    error.code = "GITHUB_CONNECTION_NOT_CONFIGURED";
    throw error;
  }
}

function buildAuthorizationUrl({ state, codeChallenge, env = process.env } = {}) {
  assertConfigured(env);
  const normalizedState = safeText(state, 200);
  const normalizedChallenge = safeText(codeChallenge, 200);
  if (!normalizedState || !/^[A-Za-z0-9_-]{32,200}$/.test(normalizedState)) {
    const error = new Error("GitHub authorization state is invalid.");
    error.code = "GITHUB_AUTH_STATE_INVALID";
    throw error;
  }
  if (!normalizedChallenge || !/^[A-Za-z0-9_-]{43}$/.test(normalizedChallenge)) {
    const error = new Error("GitHub PKCE code challenge is invalid.");
    error.code = "GITHUB_PKCE_CHALLENGE_INVALID";
    throw error;
  }

  const config = getGitHubConfig(env);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("state", normalizedState);
  url.searchParams.set("code_challenge", normalizedChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

function requestHeaders(accessToken = null) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "UNBOUND-AI-Connected-Apps"
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function fetchWithTimeout(url, options = {}, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (cause) {
    const error = new Error("GitHub request failed.");
    error.code = cause?.name === "AbortError" ? "GITHUB_REQUEST_TIMEOUT" : "GITHUB_REQUEST_FAILED";
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response, errorCode) {
  let body = null;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }
  if (!response.ok) {
    const error = new Error("GitHub rejected the request.");
    error.code = errorCode;
    error.statusCode = response.status;
    throw error;
  }
  return body && typeof body === "object" ? body : {};
}

function normalizeTokenPayload(payload = {}) {
  const accessToken = safeText(payload.access_token, 2000);
  if (!accessToken) {
    const error = new Error("GitHub token response was invalid.");
    error.code = "GITHUB_TOKEN_RESPONSE_INVALID";
    throw error;
  }
  const expiresIn = Number(payload.expires_in);
  const refreshExpiresIn = Number(payload.refresh_token_expires_in);
  const now = Date.now();
  return {
    accessToken,
    refreshToken: safeText(payload.refresh_token, 2000),
    tokenType: safeText(payload.token_type, 80) || "bearer",
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(now + expiresIn * 1000).toISOString()
      : null,
    refreshTokenExpiresAt: Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
      ? new Date(now + refreshExpiresIn * 1000).toISOString()
      : null
  };
}

async function exchangeAuthorizationCode({ code, codeVerifier, env = process.env, fetchImpl = fetch } = {}) {
  assertConfigured(env);
  const normalizedCode = safeText(code, 500);
  const verifier = normalizeCodeVerifier(codeVerifier);
  if (!normalizedCode) {
    const error = new Error("GitHub authorization code is invalid.");
    error.code = "GITHUB_AUTH_CODE_INVALID";
    throw error;
  }
  if (!verifier) {
    const error = new Error("GitHub PKCE code verifier is invalid.");
    error.code = "GITHUB_PKCE_VERIFIER_INVALID";
    throw error;
  }

  const config = getGitHubConfig(env);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: normalizedCode,
    redirect_uri: config.callbackUrl,
    code_verifier: verifier
  });
  const response = await fetchWithTimeout(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "UNBOUND-AI-Connected-Apps"
      },
      body: body.toString()
    },
    { fetchImpl }
  );
  const payload = await readJsonResponse(response, "GITHUB_TOKEN_EXCHANGE_FAILED");
  return normalizeTokenPayload(payload);
}

async function refreshUserToken({ refreshToken, env = process.env, fetchImpl = fetch } = {}) {
  assertConfigured(env);
  const token = safeText(refreshToken, 2000);
  if (!token) {
    const error = new Error("GitHub refresh token is missing.");
    error.code = "GITHUB_REFRESH_TOKEN_MISSING";
    throw error;
  }
  const config = getGitHubConfig(env);
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
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "UNBOUND-AI-Connected-Apps"
      },
      body: body.toString()
    },
    { fetchImpl }
  );
  const payload = await readJsonResponse(response, "GITHUB_TOKEN_REFRESH_FAILED");
  return normalizeTokenPayload(payload);
}

async function revokeUserToken({ accessToken, env = process.env, fetchImpl = fetch } = {}) {
  assertConfigured(env);
  const token = safeText(accessToken, 2000);
  if (!token) return { revoked: false, reason: "token-missing" };
  const config = getGitHubConfig(env);
  const response = await fetchWithTimeout(
    `${API_ORIGIN}/applications/${encodeURIComponent(config.clientId)}/token`,
    {
      method: "DELETE",
      headers: {
        ...requestHeaders(),
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ access_token: token })
    },
    { fetchImpl }
  );
  if (response.status === 204 || response.status === 404) {
    return { revoked: response.status === 204, alreadyRevoked: response.status === 404 };
  }
  const error = new Error("GitHub token revocation failed.");
  error.code = "GITHUB_TOKEN_REVOCATION_FAILED";
  error.statusCode = response.status;
  throw error;
}

async function getAuthenticatedUser({ accessToken, fetchImpl = fetch } = {}) {
  const token = safeText(accessToken, 2000);
  if (!token) {
    const error = new Error("GitHub access token is missing.");
    error.code = "GITHUB_ACCESS_TOKEN_MISSING";
    throw error;
  }
  const response = await fetchWithTimeout(
    `${API_ORIGIN}/user`,
    { headers: requestHeaders(token) },
    { fetchImpl }
  );
  const user = await readJsonResponse(response, "GITHUB_USER_LOOKUP_FAILED");
  const id = Number(user.id);
  const login = safeText(user.login, 200);
  if (!Number.isSafeInteger(id) || id <= 0 || !login) {
    const error = new Error("GitHub user response was invalid.");
    error.code = "GITHUB_USER_RESPONSE_INVALID";
    throw error;
  }
  return {
    id: String(id),
    login,
    name: safeText(user.name, 300),
    avatarUrl: cleanHttpsUrl(user.avatar_url),
    htmlUrl: cleanHttpsUrl(user.html_url)
  };
}

async function listInstallations({ accessToken, fetchImpl = fetch } = {}) {
  const response = await fetchWithTimeout(
    `${API_ORIGIN}/user/installations?per_page=100`,
    { headers: requestHeaders(accessToken) },
    { fetchImpl }
  );
  const payload = await readJsonResponse(response, "GITHUB_INSTALLATIONS_LOOKUP_FAILED");
  return (Array.isArray(payload.installations) ? payload.installations : [])
    .map((item) => ({
      id: Number.isSafeInteger(Number(item?.id)) ? String(item.id) : null,
      accountId: Number.isSafeInteger(Number(item?.account?.id)) ? String(item.account.id) : null,
      accountLogin: safeText(item?.account?.login, 200),
      accountType: safeText(item?.account?.type, 80),
      repositorySelection: safeText(item?.repository_selection, 80)
    }))
    .filter((item) => item.id && item.accountLogin);
}

async function listRepositoriesForInstallation({ accessToken, installationId, fetchImpl = fetch } = {}) {
  const id = String(installationId || "").trim();
  if (!/^\d{1,30}$/.test(id)) {
    const error = new Error("GitHub installation id is invalid.");
    error.code = "GITHUB_INSTALLATION_ID_INVALID";
    throw error;
  }

  const repositories = [];
  for (let page = 1; page <= 5 && repositories.length < MAX_REPOSITORIES; page += 1) {
    const response = await fetchWithTimeout(
      `${API_ORIGIN}/user/installations/${id}/repositories?per_page=100&page=${page}`,
      { headers: requestHeaders(accessToken) },
      { fetchImpl }
    );
    const payload = await readJsonResponse(response, "GITHUB_REPOSITORIES_LOOKUP_FAILED");
    const pageItems = Array.isArray(payload.repositories) ? payload.repositories : [];
    for (const repo of pageItems) {
      if (repositories.length >= MAX_REPOSITORIES) break;
      const repoId = Number(repo?.id);
      const fullName = safeText(repo?.full_name, 300);
      if (!Number.isSafeInteger(repoId) || repoId <= 0 || !fullName) continue;
      repositories.push({
        id: String(repoId),
        fullName,
        private: Boolean(repo.private),
        archived: Boolean(repo.archived),
        defaultBranch: safeText(repo.default_branch, 200),
        htmlUrl: cleanHttpsUrl(repo.html_url),
        updatedAt: safeText(repo.updated_at, 80)
      });
    }
    if (pageItems.length < 100) break;
  }
  return repositories;
}

async function listAuthorizedRepositories({ accessToken, fetchImpl = fetch } = {}) {
  const installations = await listInstallations({ accessToken, fetchImpl });
  const repositories = [];
  for (const installation of installations) {
    const items = await listRepositoriesForInstallation({
      accessToken,
      installationId: installation.id,
      fetchImpl
    });
    for (const repo of items) {
      if (repositories.length >= MAX_REPOSITORIES) break;
      repositories.push({ ...repo, installationId: installation.id });
    }
    if (repositories.length >= MAX_REPOSITORIES) break;
  }
  return { installations, repositories };
}

module.exports = {
  PROVIDER_ID,
  AUTHORIZE_URL,
  TOKEN_URL,
  API_ORIGIN,
  API_VERSION,
  normalizeCodeVerifier,
  createPkceChallenge,
  getGitHubConfig,
  publicGitHubStatus,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshUserToken,
  revokeUserToken,
  getAuthenticatedUser,
  listInstallations,
  listRepositoriesForInstallation,
  listAuthorizedRepositories
};
