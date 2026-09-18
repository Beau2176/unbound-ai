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
const {
  publicGoogleWorkspaceStatus,
  createPkceChallenge: createGooglePkceChallenge,
  buildAuthorizationUrl: buildGoogleAuthorizationUrl,
  exchangeAuthorizationCode: exchangeGoogleAuthorizationCode,
  refreshUserToken: refreshGoogleUserToken,
  revokeUserToken: revokeGoogleUserToken,
  getAuthenticatedUser: getGoogleAuthenticatedUser,
  listGmailMetadata,
  listCalendarEvents,
  listDriveMetadata
} = require("./providers/google-workspace");
const {
  publicSlackStatus,
  createPkceChallenge: createSlackPkceChallenge,
  buildAuthorizationUrl: buildSlackAuthorizationUrl,
  exchangeAuthorizationCode: exchangeSlackAuthorizationCode,
  refreshUserToken: refreshSlackUserToken,
  getAuthenticatedWorkspace,
  listPublicChannels,
  listChannelHistory,
  revokeUserToken: revokeSlackUserToken
} = require("./providers/slack");
const { encryptSecret, decryptSecret } = require("./token-vault");
const {
  REFRESH_SKEW_MS,
  secretAad: connectionSecretAad,
  publicConnection,
  loadConnection: loadStoredConnection,
  listConnections,
  saveTokens: saveStoredTokens,
  getUsableAccessToken: getStoredUsableAccessToken,
  markConnectionUsed,
  deleteConnection
} = require("./store");

const OAUTH_STATE_TTL_MINUTES = 10;

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

function secretAad(userId, kind) {
  return connectionSecretAad("github", userId, kind);
}

async function loadConnection(pool, userId, options = {}) {
  return loadStoredConnection(pool, userId, "github", options);
}

async function saveTokens(pool, userId, account, tokens) {
  return saveStoredTokens(pool, userId, "github", account, tokens);
}

async function getUsableAccessToken(pool, userId) {
  return getStoredUsableAccessToken(pool, userId, "github", {
    refreshAccessToken: refreshUserToken
  });
}

async function getGoogleWorkspaceAccessToken(pool, userId) {
  return getStoredUsableAccessToken(pool, userId, "google_workspace", {
    refreshAccessToken: refreshGoogleUserToken
  });
}

async function getSlackAccessToken(pool, userId) {
  return getStoredUsableAccessToken(pool, userId, "slack", {
    refreshAccessToken: refreshSlackUserToken
  });
}

function createConnectionsRouter({ getPool } = {}) {
  if (typeof getPool !== "function") {
    throw new Error("Connected Apps requires a database pool provider.");
  }
  const router = express.Router();

  router.get("/status", async (req, res) => {
    try {
      const connections = await listConnections(getPool(), req.user.id);
      return res.json({
        github: publicGitHubStatus(),
        googleWorkspace: publicGoogleWorkspaceStatus(),
        slack: publicSlackStatus(),
        connection: connections.find((item) => item.provider === "github") || null,
        connections
      });
    } catch (error) {
      console.error("UNBOUND AI CONNECTED APPS STATUS ERROR:", error?.code || error?.message || "unknown");
      return res.status(500).json({ error: "Could not load Connected Apps status." });
    }
  });

  router.post("/google/authorize", async (req, res) => {
    try {
      if (!publicGoogleWorkspaceStatus().configured) {
        return res.status(503).json({
          error: "Google Workspace Connected Apps is not configured yet.",
          provider: publicGoogleWorkspaceStatus()
        });
      }
      const rawState = crypto.randomBytes(32).toString("base64url");
      const codeVerifier = createPkceVerifier();
      const codeChallenge = createGooglePkceChallenge(codeVerifier);
      const verifierCiphertext = encryptSecret(codeVerifier, {
        aad: connectionSecretAad("google_workspace", req.user.id, "pkce")
      });
      const hash = stateHash(rawState);
      const pool = getPool();
      await pool.query(
        `DELETE FROM connected_app_oauth_states
         WHERE user_id = $1 AND provider = $2`,
        [req.user.id, "google_workspace"]
      );
      await pool.query(
        `INSERT INTO connected_app_oauth_states (
           user_id, provider, state_hash, pkce_verifier_ciphertext, expires_at, created_at
         ) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes', NOW())`,
        [req.user.id, "google_workspace", hash, verifierCiphertext]
      );
      return res.json({
        authorizationUrl: buildGoogleAuthorizationUrl({
          state: rawState,
          codeChallenge
        }),
        expiresInSeconds: OAUTH_STATE_TTL_MINUTES * 60
      });
    } catch (error) {
      console.error("UNBOUND AI GOOGLE WORKSPACE AUTHORIZE ERROR:", error?.code || error?.message || "unknown");
      return res.status(Number(error?.statusCode) || 500).json({
        error: "Could not start Google Workspace authorization.",
        code: error?.code || "GOOGLE_WORKSPACE_AUTHORIZE_FAILED"
      });
    }
  });

  router.get("/google/callback", async (req, res) => {
    const code = String(req.query.code || "").trim();
    const state = cleanState(req.query.state);
    if (!code || !state) {
      return res.redirect("/connected-apps.html?google=invalid_callback");
    }

    const pool = getPool();
    try {
      const stateResult = await pool.query(
        `DELETE FROM connected_app_oauth_states
         WHERE user_id = $1
           AND provider = $2
           AND state_hash = $3
           AND expires_at > NOW()
         RETURNING id, pkce_verifier_ciphertext`,
        [req.user.id, "google_workspace", stateHash(state)]
      );
      const stateRow = stateResult.rows[0];
      if (!stateRow?.pkce_verifier_ciphertext) {
        return res.redirect("/connected-apps.html?google=state_rejected");
      }

      const codeVerifier = decryptSecret(stateRow.pkce_verifier_ciphertext, {
        aad: connectionSecretAad("google_workspace", req.user.id, "pkce")
      });
      const tokens = await exchangeGoogleAuthorizationCode({ code, codeVerifier });
      const account = await getGoogleAuthenticatedUser({
        accessToken: tokens.accessToken
      });
      await saveStoredTokens(
        pool,
        req.user.id,
        "google_workspace",
        account,
        tokens
      );
      return res.redirect("/connected-apps.html?google=connected");
    } catch (error) {
      console.error("UNBOUND AI GOOGLE WORKSPACE CALLBACK ERROR:", error?.code || error?.message || "unknown");
      return res.redirect("/connected-apps.html?google=failed");
    }
  });

  router.get("/google/mail", async (req, res) => {
    try {
      const pool = getPool();
      const { accessToken } = await getGoogleWorkspaceAccessToken(pool, req.user.id);
      const result = await listGmailMetadata({ accessToken });
      await markConnectionUsed(pool, req.user.id, "google_workspace");
      return res.json({
        provider: "google_workspace",
        readOnly: true,
        metadataOnly: true,
        ...result
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 502;
      console.error("UNBOUND AI GOOGLE MAIL LIST ERROR:", error?.code || error?.message || "unknown");
      return res.status(statusCode).json({
        error: statusCode === 401
          ? "Google Workspace authorization expired. Reconnect Google Workspace."
          : statusCode === 404
            ? "Google Workspace is not connected."
            : "Could not load Gmail metadata.",
        code: error?.code || "GOOGLE_WORKSPACE_GMAIL_LIST_FAILED"
      });
    }
  });

  router.get("/google/calendar", async (req, res) => {
    try {
      const pool = getPool();
      const { accessToken } = await getGoogleWorkspaceAccessToken(pool, req.user.id);
      const result = await listCalendarEvents({
        accessToken,
        timeMin: req.query.timeMin
      });
      await markConnectionUsed(pool, req.user.id, "google_workspace");
      return res.json({
        provider: "google_workspace",
        readOnly: true,
        ...result
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 502;
      console.error("UNBOUND AI GOOGLE CALENDAR LIST ERROR:", error?.code || error?.message || "unknown");
      return res.status(statusCode).json({
        error: statusCode === 401
          ? "Google Workspace authorization expired. Reconnect Google Workspace."
          : statusCode === 404
            ? "Google Workspace is not connected."
            : "Could not load Google Calendar events.",
        code: error?.code || "GOOGLE_WORKSPACE_CALENDAR_LIST_FAILED"
      });
    }
  });

  router.get("/google/drive", async (req, res) => {
    try {
      const pool = getPool();
      const { accessToken } = await getGoogleWorkspaceAccessToken(pool, req.user.id);
      const result = await listDriveMetadata({
        accessToken,
        query: req.query.q
      });
      await markConnectionUsed(pool, req.user.id, "google_workspace");
      return res.json({
        provider: "google_workspace",
        readOnly: true,
        metadataOnly: true,
        ...result
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 502;
      console.error("UNBOUND AI GOOGLE DRIVE LIST ERROR:", error?.code || error?.message || "unknown");
      return res.status(statusCode).json({
        error: statusCode === 401
          ? "Google Workspace authorization expired. Reconnect Google Workspace."
          : statusCode === 404
            ? "Google Workspace is not connected."
            : "Could not load Google Drive metadata.",
        code: error?.code || "GOOGLE_WORKSPACE_DRIVE_LIST_FAILED"
      });
    }
  });

  router.delete("/google", async (req, res) => {
    const pool = getPool();
    const client = await pool.connect();
    let providerRevoked = false;
    let providerWarning = null;
    try {
      await client.query("BEGIN");
      const row = await loadStoredConnection(
        client,
        req.user.id,
        "google_workspace",
        { forUpdate: true }
      );
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Google Workspace is not connected." });
      }
      const accessToken = decryptSecret(row.access_token_ciphertext, {
        aad: connectionSecretAad("google_workspace", req.user.id, "access")
      });
      const refreshToken = row.refresh_token_ciphertext
        ? decryptSecret(row.refresh_token_ciphertext, {
            aad: connectionSecretAad("google_workspace", req.user.id, "refresh")
          })
        : null;
      try {
        const revoked = await revokeGoogleUserToken({
          accessToken,
          refreshToken
        });
        providerRevoked = Boolean(revoked.revoked);
      } catch (error) {
        providerWarning = "UNBOUND removed the local Google Workspace connection, but provider revocation could not be confirmed. Review your Google Account app access if needed.";
        console.warn("UNBOUND AI GOOGLE PROVIDER REVOCATION WARNING:", error?.code || error?.message || "unknown");
      }
      await deleteConnection(client, req.user.id, "google_workspace");
      await client.query(
        `DELETE FROM connected_app_oauth_states
         WHERE user_id = $1 AND provider = $2`,
        [req.user.id, "google_workspace"]
      );
      await client.query("COMMIT");
      return res.json({
        ok: true,
        provider: "google_workspace",
        localConnectionRemoved: true,
        providerRevoked,
        warning: providerWarning
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("UNBOUND AI GOOGLE DISCONNECT ERROR:", error?.code || error?.message || "unknown");
      return res.status(500).json({ error: "Could not disconnect Google Workspace." });
    } finally {
      client.release();
    }
  });


  router.post("/slack/authorize", async (req, res) => {
    try {
      if (!publicSlackStatus().configured) {
        return res.status(503).json({
          error: "Slack Connected Apps is not configured yet.",
          provider: publicSlackStatus()
        });
      }
      const rawState = crypto.randomBytes(32).toString("base64url");
      const codeVerifier = createPkceVerifier();
      const codeChallenge = createSlackPkceChallenge(codeVerifier);
      const verifierCiphertext = encryptSecret(codeVerifier, {
        aad: connectionSecretAad("slack", req.user.id, "pkce")
      });
      const hash = stateHash(rawState);
      const pool = getPool();
      await pool.query(
        `DELETE FROM connected_app_oauth_states
         WHERE user_id = $1 AND provider = $2`,
        [req.user.id, "slack"]
      );
      await pool.query(
        `INSERT INTO connected_app_oauth_states (
           user_id, provider, state_hash, pkce_verifier_ciphertext, expires_at, created_at
         ) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes', NOW())`,
        [req.user.id, "slack", hash, verifierCiphertext]
      );
      return res.json({
        authorizationUrl: buildSlackAuthorizationUrl({
          state: rawState,
          codeChallenge
        }),
        expiresInSeconds: OAUTH_STATE_TTL_MINUTES * 60
      });
    } catch (error) {
      console.error("UNBOUND AI SLACK AUTHORIZE ERROR:", error?.code || error?.message || "unknown");
      return res.status(Number(error?.statusCode) || 500).json({
        error: "Could not start Slack authorization.",
        code: error?.code || "SLACK_AUTHORIZE_FAILED"
      });
    }
  });

  router.get("/slack/callback", async (req, res) => {
    const code = String(req.query.code || "").trim();
    const state = cleanState(req.query.state);
    if (!code || !state) {
      return res.redirect("/connected-apps.html?slack=invalid_callback");
    }

    const pool = getPool();
    try {
      const stateResult = await pool.query(
        `DELETE FROM connected_app_oauth_states
         WHERE user_id = $1
           AND provider = $2
           AND state_hash = $3
           AND expires_at > NOW()
         RETURNING id, pkce_verifier_ciphertext`,
        [req.user.id, "slack", stateHash(state)]
      );
      const stateRow = stateResult.rows[0];
      if (!stateRow?.pkce_verifier_ciphertext) {
        return res.redirect("/connected-apps.html?slack=state_rejected");
      }

      const codeVerifier = decryptSecret(stateRow.pkce_verifier_ciphertext, {
        aad: connectionSecretAad("slack", req.user.id, "pkce")
      });
      const exchanged = await exchangeSlackAuthorizationCode({ code, codeVerifier });
      const account = await getAuthenticatedWorkspace({
        accessToken: exchanged.tokens.accessToken
      });
      await saveStoredTokens(
        pool,
        req.user.id,
        "slack",
        account,
        exchanged.tokens
      );
      return res.redirect("/connected-apps.html?slack=connected");
    } catch (error) {
      console.error("UNBOUND AI SLACK CALLBACK ERROR:", error?.code || error?.message || "unknown");
      return res.redirect("/connected-apps.html?slack=failed");
    }
  });

  router.get("/slack/channels", async (req, res) => {
    try {
      const pool = getPool();
      const { accessToken } = await getSlackAccessToken(pool, req.user.id);
      const result = await listPublicChannels({ accessToken });
      await markConnectionUsed(pool, req.user.id, "slack");
      return res.json({
        provider: "slack",
        readOnly: true,
        ...result
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 502;
      console.error("UNBOUND AI SLACK CHANNEL LIST ERROR:", error?.code || error?.message || "unknown");
      return res.status(statusCode).json({
        error: statusCode === 401
          ? "Slack authorization expired. Reconnect Slack."
          : statusCode === 404
            ? "Slack is not connected."
            : statusCode === 429
              ? "Slack is rate limiting channel access. Try again shortly."
              : "Could not load Slack channels.",
        code: error?.code || "SLACK_CHANNEL_LIST_FAILED"
      });
    }
  });

  router.get("/slack/history", async (req, res) => {
    try {
      const pool = getPool();
      const { accessToken } = await getSlackAccessToken(pool, req.user.id);
      const result = await listChannelHistory({
        accessToken,
        channelId: req.query.channel
      });
      await markConnectionUsed(pool, req.user.id, "slack");
      return res.json({
        provider: "slack",
        readOnly: true,
        channelId: String(req.query.channel || ""),
        ...result
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 502;
      console.error("UNBOUND AI SLACK HISTORY ERROR:", error?.code || error?.message || "unknown");
      return res.status(statusCode).json({
        error: statusCode === 400
          ? "Slack channel ID is invalid."
          : statusCode === 401
            ? "Slack authorization expired. Reconnect Slack."
            : statusCode === 404
              ? "Slack is not connected."
              : statusCode === 429
                ? "Slack is rate limiting channel history. Try again shortly."
                : "Could not load Slack channel history.",
        code: error?.code || "SLACK_CHANNEL_HISTORY_FAILED"
      });
    }
  });

  router.delete("/slack", async (req, res) => {
    const pool = getPool();
    const client = await pool.connect();
    let providerRevoked = false;
    let providerWarning = null;
    try {
      await client.query("BEGIN");
      const row = await loadStoredConnection(
        client,
        req.user.id,
        "slack",
        { forUpdate: true }
      );
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Slack is not connected." });
      }
      const accessToken = decryptSecret(row.access_token_ciphertext, {
        aad: connectionSecretAad("slack", req.user.id, "access")
      });
      try {
        const revoked = await revokeSlackUserToken({ accessToken });
        providerRevoked = Boolean(revoked.revoked);
      } catch (error) {
        providerWarning = "UNBOUND removed the local Slack connection, but provider revocation could not be confirmed. Review your Slack app authorizations if needed.";
        console.warn("UNBOUND AI SLACK PROVIDER REVOCATION WARNING:", error?.code || error?.message || "unknown");
      }
      await deleteConnection(client, req.user.id, "slack");
      await client.query(
        `DELETE FROM connected_app_oauth_states
         WHERE user_id = $1 AND provider = $2`,
        [req.user.id, "slack"]
      );
      await client.query("COMMIT");
      return res.json({
        ok: true,
        provider: "slack",
        localConnectionRemoved: true,
        providerRevoked,
        warning: providerWarning
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("UNBOUND AI SLACK DISCONNECT ERROR:", error?.code || error?.message || "unknown");
      return res.status(500).json({ error: "Could not disconnect Slack." });
    } finally {
      client.release();
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
      await markConnectionUsed(pool, req.user.id, "github");
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
      await deleteConnection(client, req.user.id, "github");
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
