const { encryptSecret, decryptSecret } = require("./token-vault");

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const SUPPORTED_CONNECTED_APP_PROVIDERS = Object.freeze([
  "github",
  "google_workspace",
  "microsoft_365",
  "slack"
]);

function normalizeProviderId(value) {
  const provider = String(value || "").trim().toLowerCase();
  return SUPPORTED_CONNECTED_APP_PROVIDERS.includes(provider) ? provider : null;
}

function providerCode(provider, suffix) {
  return String(provider || "connected_app")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_") + "_" + suffix;
}

function secretAad(provider, userId, kind) {
  const normalized = normalizeProviderId(provider);
  if (!normalized) {
    const error = new Error("Connected Apps provider is invalid.");
    error.code = "CONNECTED_APPS_PROVIDER_INVALID";
    throw error;
  }
  return `unbound:${normalized}:${String(userId)}:${String(kind || "")}`;
}

function publicConnection(row) {
  if (!row) return null;
  return {
    provider: row.provider,
    accountId: row.provider_account_id,
    accountLogin: row.provider_account_login,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.access_token_expires_at,
    refreshExpiresAt: row.refresh_token_expires_at,
    writeActionsEnabled: false
  };
}

async function loadConnection(pool, userId, provider, { forUpdate = false } = {}) {
  const normalized = normalizeProviderId(provider);
  if (!normalized) {
    const error = new Error("Connected Apps provider is invalid.");
    error.code = "CONNECTED_APPS_PROVIDER_INVALID";
    throw error;
  }
  const result = await pool.query(
    `SELECT provider, provider_account_id, provider_account_login,
            access_token_ciphertext, refresh_token_ciphertext,
            access_token_expires_at, refresh_token_expires_at,
            connected_at, updated_at, last_used_at
     FROM connected_app_connections
     WHERE user_id = $1 AND provider = $2
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [userId, normalized]
  );
  return result.rows[0] || null;
}

async function listConnections(pool, userId) {
  const result = await pool.query(
    `SELECT provider, provider_account_id, provider_account_login,
            access_token_expires_at, refresh_token_expires_at,
            connected_at, updated_at, last_used_at
     FROM connected_app_connections
     WHERE user_id = $1
     ORDER BY provider ASC`,
    [userId]
  );
  return result.rows.map(publicConnection);
}

function cleanAccountValue(value, max = 300) {
  const text = String(value || "").trim();
  return text && text.length <= max ? text : null;
}

async function saveTokens(pool, userId, provider, account, tokens) {
  const normalized = normalizeProviderId(provider);
  if (!normalized) {
    const error = new Error("Connected Apps provider is invalid.");
    error.code = "CONNECTED_APPS_PROVIDER_INVALID";
    throw error;
  }

  const accountId = cleanAccountValue(account?.id);
  const accountLogin = cleanAccountValue(account?.login);
  const accessToken = String(tokens?.accessToken || "").trim();
  const refreshToken = String(tokens?.refreshToken || "").trim() || null;
  if (!accountId || !accountLogin || !accessToken) {
    const error = new Error("Connected Apps account or token data is invalid.");
    error.code = "CONNECTED_APPS_CONNECTION_DATA_INVALID";
    throw error;
  }

  const accessCiphertext = encryptSecret(accessToken, {
    aad: secretAad(normalized, userId, "access")
  });
  const refreshCiphertext = refreshToken
    ? encryptSecret(refreshToken, { aad: secretAad(normalized, userId, "refresh") })
    : null;

  const result = await pool.query(
    `INSERT INTO connected_app_connections (
       user_id, provider, provider_account_id, provider_account_login,
       access_token_ciphertext, refresh_token_ciphertext,
       access_token_expires_at, refresh_token_expires_at,
       connected_at, updated_at, last_used_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NULL)
     ON CONFLICT (user_id, provider)
     DO UPDATE SET
       provider_account_id = EXCLUDED.provider_account_id,
       provider_account_login = EXCLUDED.provider_account_login,
       access_token_ciphertext = EXCLUDED.access_token_ciphertext,
       refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
       updated_at = NOW(),
       last_used_at = NULL
     RETURNING provider, provider_account_id, provider_account_login,
               access_token_expires_at, refresh_token_expires_at,
               connected_at, updated_at, last_used_at`,
    [
      userId,
      normalized,
      accountId,
      accountLogin,
      accessCiphertext,
      refreshCiphertext,
      tokens?.expiresAt || null,
      tokens?.refreshTokenExpiresAt || null
    ]
  );
  return result.rows[0];
}

function tokenNeedsRefresh(row, now = Date.now()) {
  if (!row?.access_token_expires_at) return false;
  const expiresAt = new Date(row.access_token_expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now + REFRESH_SKEW_MS;
}

async function getUsableAccessToken(
  pool,
  userId,
  provider,
  { refreshAccessToken = null } = {}
) {
  const normalized = normalizeProviderId(provider);
  if (!normalized) {
    const error = new Error("Connected Apps provider is invalid.");
    error.code = "CONNECTED_APPS_PROVIDER_INVALID";
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let row = await loadConnection(client, userId, normalized, { forUpdate: true });
    if (!row) {
      const error = new Error("Connected app is not connected.");
      error.code = providerCode(normalized, "CONNECTION_MISSING");
      error.statusCode = 404;
      throw error;
    }

    let accessToken = decryptSecret(row.access_token_ciphertext, {
      aad: secretAad(normalized, userId, "access")
    });

    if (tokenNeedsRefresh(row)) {
      if (!row.refresh_token_ciphertext || typeof refreshAccessToken !== "function") {
        const error = new Error("Connected app authorization has expired. Reconnect the app.");
        error.code = providerCode(normalized, "CONNECTION_REAUTH_REQUIRED");
        error.statusCode = 401;
        throw error;
      }
      const refreshToken = decryptSecret(row.refresh_token_ciphertext, {
        aad: secretAad(normalized, userId, "refresh")
      });
      const refreshed = await refreshAccessToken({ refreshToken });
      const account = {
        id: row.provider_account_id,
        login: row.provider_account_login
      };
      row = await saveTokens(client, userId, normalized, account, refreshed);
      accessToken = refreshed.accessToken;
    }

    await client.query("COMMIT");
    return { accessToken, row };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function markConnectionUsed(pool, userId, provider) {
  const normalized = normalizeProviderId(provider);
  if (!normalized) return false;
  const result = await pool.query(
    `UPDATE connected_app_connections
     SET last_used_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND provider = $2
     RETURNING provider`,
    [userId, normalized]
  );
  return Boolean(result.rows[0]);
}

async function deleteConnection(pool, userId, provider) {
  const normalized = normalizeProviderId(provider);
  if (!normalized) return false;
  const result = await pool.query(
    `DELETE FROM connected_app_connections
     WHERE user_id = $1 AND provider = $2
     RETURNING provider`,
    [userId, normalized]
  );
  return Boolean(result.rows[0]);
}

module.exports = {
  REFRESH_SKEW_MS,
  SUPPORTED_CONNECTED_APP_PROVIDERS,
  normalizeProviderId,
  providerCode,
  secretAad,
  publicConnection,
  loadConnection,
  listConnections,
  saveTokens,
  tokenNeedsRefresh,
  getUsableAccessToken,
  markConnectionUsed,
  deleteConnection
};
