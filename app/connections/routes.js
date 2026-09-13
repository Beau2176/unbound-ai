const crypto = require("crypto");
const express = require("express");
const path = require("path");
const {
  publicGitHubStatus,
  createPkceChallenge,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshUserToken,
  revokeUserToken,
  getAuthenticatedUser,
  listAuthorizedRepositories
} = require("./providers/github");
const { encryptSecret, decryptSecret } = require("./token-vault");

const OAUTH_STATE_TTL_MINUTES = 10;
const REFRESH_SKEW_MS = 5 * 60 * 1000;

function stateHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function cleanState(value) {
  const state = String(value || "").trim();
  return /^[A-Za-z0-9_-]{32,200}$/.test(state) ? state : null;
}

function createPkceVerifier() {
  return crypto.randomBytes(32).toString("base64url");
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

function secretAad(userId, kind) {
  return `unbound:github:${String(userId)}:${kind}`;
}

async function loadConnection(pool, userId, { forUpdate = false } = {}) {
  const result = await pool.query(
    `SELECT provider, provider_account_id, provider_account_login,
            access_token_ciphertext, refresh_token_ciphertext,
            access_token_expires_at, refresh_token_expires_at,
            connected_at, updated_at, last_used_at
     FROM connected_app_connections
     WHERE user_id = $1 AND provider = 'github'
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [userId]
  );
  return result.rows[0] || null;
}

async function saveTokens(pool, userId, account, tokens) {
  const accessCiphertext = encryptSecret(tokens.accessToken, {
    aad: secretAad(userId, "access")
  });
  const refreshCiphertext = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken, { aad: secretAad(userId, "refresh") })
    : null;

  const result = await pool.query(
    `INSERT INTO connected_app_connections (
       user_id, provider, provider_account_id, provider_account_login,
       access_token_ciphertext, refresh_token_ciphertext,
       access_token_expires_at, refresh_token_expires_at,
       connected_at, updated_at, last_used_at
     ) VALUES ($1, 'github', $2, $3, $4, $5, $6, $7, NOW(), NOW(), NULL)
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
      account.id,
      account.login,
      accessCiphertext,
      refreshCiphertext,
      tokens.expiresAt,
      tokens.refreshTokenExpiresAt
    ]
  );
  return result.rows[0];
}

function tokenNeedsRefresh(row) {
  if (!row?.access_token_expires_at) return false;
  const expiresAt = new Date(row.access_token_expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now() + REFRESH_SKEW_MS;
}

async function getUsableAccessToken(pool, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let row = await loadConnection(client, userId, { forUpdate: true });
    if (!row) {
      const error = new Error("GitHub is not connected.");
      error.code = "GITHUB_CONNECTION_MISSING";
      error.statusCode = 404;
      throw error;
    }

    let accessToken = decryptSecret(row.access_token_ciphertext, {
      aad: secretAad(userId, "access")
    });

    if (tokenNeedsRefresh(row)) {
      if (!row.refresh_token_ciphertext) {
        const error = new Error("GitHub authorization has expired. Reconnect GitHub.");
        error.code = "GITHUB_CONNECTION_REAUTH_REQUIRED";
        error.statusCode = 401;
        throw error;
      }
      const refreshToken = decryptSecret(row.refresh_token_ciphertext, {
        aad: secretAad(userId, "refresh")
      });
      const refreshed = await refreshUserToken({ refreshToken });
      const account = {
        id: row.provider_account_id,
        login: row.provider_account_login
      };
      row = await saveTokens(client, userId, account, refreshed);
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

function createConnectionsRouter({ getPool } = {}) {
  if (typeof getPool !== "function") {
    throw new Error("Connected Apps requires a database pool provider.");
  }
  const router = express.Router();

  router.get("/status", async (req, res) => {
    try {
      const row = await loadConnection(getPool(), req.user.id);
      return res.json({
        github: publicGitHubStatus(),
        connection: publicConnection(row)
      });
    } catch (error) {
      console.error("UNBOUND AI CONNECTED APPS STATUS ERROR:", error?.code || error?.message || "unknown");
      return res.status(500).json({ error: "Could not load Connected Apps status." });
    }
  });

  router.post("/github/authorize", async (req, res) => {
    try {
      if (!publicGitHubStatus().configured) {
        return res.status(503).json({
          error: "GitHub Connected Apps is not configured yet.",
          provider: publicGitHubStatus()
        });
      }
      const rawState = crypto.randomBytes(32).toString("base64url");
      const codeVerifier = createPkceVerifier();
      const codeChallenge = createPkceChallenge(codeVerifier);
      const verifierCiphertext = encryptSecret(codeVerifier, {
        aad: secretAad(req.user.id, "pkce")
      });
      const hash = stateHash(rawState);
      const pool = getPool();
      await pool.query(
        `DELETE FROM connected_app_oauth_states
         WHERE user_id = $1 AND provider = 'github'`,
        [req.user.id]
      );
      await pool.query(
        `INSERT INTO connected_app_oauth_states (
           user_id, provider, state_hash, pkce_verifier_ciphertext, expires_at, created_at
         ) VALUES ($1, 'github', $2, $3, NOW() + INTERVAL '${OAUTH_STATE_TTL_MINUTES} minutes', NOW())`,
        [req.user.id, hash, verifierCiphertext]
      );
      return res.json({
        authorizationUrl: buildAuthorizationUrl({ state: rawState, codeChallenge }),
        expiresInSeconds: OAUTH_STATE_TTL_MINUTES * 60
      });
    } catch (error) {
      console.error("UNBOUND AI GITHUB AUTHORIZE ERROR:", error?.code || error?.message || "unknown");
      return res.status(500).json({ error: "Could not start GitHub authorization." });
    }
  });

  router.get("/github/callback", async (req, res) => {
    const code = String(req.query.code || "").trim();
    const state = cleanState(req.query.state);
    if (!code || !state) {
      return res.redirect("/connected-apps.html?github=invalid_callback");
    }

    const pool = getPool();
    try {
      const stateResult = await pool.query(
        `DELETE FROM connected_app_oauth_states
         WHERE user_id = $1
           AND provider = 'github'
           AND state_hash = $2
           AND expires_at > NOW()
         RETURNING id, pkce_verifier_ciphertext`,
        [req.user.id, stateHash(state)]
      );
      const stateRow = stateResult.rows[0];
      if (!stateRow?.pkce_verifier_ciphertext) {
        return res.redirect("/connected-apps.html?github=state_rejected");
      }

      const codeVerifier = decryptSecret(stateRow.pkce_verifier_ciphertext, {
        aad: secretAad(req.user.id, "pkce")
      });
      const tokens = await exchangeAuthorizationCode({ code, codeVerifier });
      const account = await getAuthenticatedUser({ accessToken: tokens.accessToken });
      await saveTokens(pool, req.user.id, account, tokens);
      return res.redirect("/connected-apps.html?github=connected");
    } catch (error) {
      console.error("UNBOUND AI GITHUB CALLBACK ERROR:", error?.code || error?.message || "unknown");
      return res.redirect("/connected-apps.html?github=failed");
    }
  });

  router.get("/github/repositories", async (req, res) => {
    try {
      const pool = getPool();
      const { accessToken } = await getUsableAccessToken(pool, req.user.id);
      const result = await listAuthorizedRepositories({ accessToken });
      await pool.query(
        `UPDATE connected_app_connections
         SET last_used_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND provider = 'github'`,
        [req.user.id]
      );
      return res.json({
        provider: "github",
        readOnly: true,
        installations: result.installations,
        repositories: result.repositories
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode) || (String(error?.code || "").includes("REAUTH") ? 401 : 502);
      console.error("UNBOUND AI GITHUB REPOSITORY LIST ERROR:", error?.code || error?.message || "unknown");
      return res.status(statusCode).json({
        error: statusCode === 401
          ? "GitHub authorization expired. Reconnect GitHub."
          : statusCode === 404
            ? "GitHub is not connected."
            : "Could not load GitHub repositories.",
        code: error?.code || "GITHUB_REPOSITORY_LIST_FAILED"
      });
    }
  });

  router.delete("/github", async (req, res) => {
    const pool = getPool();
    const client = await pool.connect();
    let providerRevoked = false;
    let providerWarning = null;
    try {
      await client.query("BEGIN");
      const row = await loadConnection(client, req.user.id, { forUpdate: true });
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "GitHub is not connected." });
      }
      const accessToken = decryptSecret(row.access_token_ciphertext, {
        aad: secretAad(req.user.id, "access")
      });
      try {
        const revoked = await revokeUserToken({ accessToken });
        providerRevoked = Boolean(revoked.revoked || revoked.alreadyRevoked);
      } catch (error) {
        providerWarning = "UNBOUND removed the local connection, but GitHub token revocation could not be confirmed. Review installed GitHub Apps if needed.";
        console.warn("UNBOUND AI GITHUB PROVIDER REVOCATION WARNING:", error?.code || error?.message || "unknown");
      }
      await client.query(
        `DELETE FROM connected_app_connections
         WHERE user_id = $1 AND provider = 'github'`,
        [req.user.id]
      );
      await client.query(
        `DELETE FROM connected_app_oauth_states
         WHERE user_id = $1 AND provider = 'github'`,
        [req.user.id]
      );
      await client.query("COMMIT");
      return res.json({
        ok: true,
        provider: "github",
        localConnectionRemoved: true,
        providerRevoked,
        warning: providerWarning
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("UNBOUND AI GITHUB DISCONNECT ERROR:", error?.code || error?.message || "unknown");
      return res.status(500).json({ error: "Could not disconnect GitHub." });
    } finally {
      client.release();
    }
  });

  return router;
}

function sendConnectedAppsPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "connected-apps.html"));
}

module.exports = {
  OAUTH_STATE_TTL_MINUTES,
  REFRESH_SKEW_MS,
  stateHash,
  createPkceVerifier,
  publicConnection,
  createConnectionsRouter,
  sendConnectedAppsPage
};
