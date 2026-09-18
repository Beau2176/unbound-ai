const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  AUTHORIZE_URL,
  TOKEN_URL,
  API_ORIGIN,
  READ_ONLY_SCOPES,
  MAX_HISTORY_MESSAGES,
  createPkceChallenge,
  publicSlackStatus,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshUserToken,
  getAuthenticatedWorkspace,
  listPublicChannels,
  listChannelHistory,
  revokeUserToken
} = require("../connections/providers/slack");
const { createPkceVerifier } = require("../connections/routes");
const { connectorCatalog } = require("../platform/registry");

function slackResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

async function main() {
  const originalKey = process.env.CONNECTED_APPS_TOKEN_KEY;
  process.env.CONNECTED_APPS_TOKEN_KEY = Buffer.alloc(32, 29).toString("base64");

  const env = {
    CONNECTED_APPS_TOKEN_KEY: process.env.CONNECTED_APPS_TOKEN_KEY,
    SLACK_CLIENT_ID: "1234567890.1234567890",
    SLACK_REDIRECT_URL: "https://unbound.example/api/connections/slack/callback",
    SLACK_APP_REGISTRATION_VERIFIED: "true",
    SLACK_PKCE_ENABLED_VERIFIED: "true",
    SLACK_READ_ONLY_SCOPES_VERIFIED: "true",
    SLACK_TOKEN_ROTATION_VERIFIED: "true"
  };

  try {
    const status = publicSlackStatus(env);
    assert.strictEqual(status.configured, true);
    assert.strictEqual(status.writeActionsEnabled, false);
    assert.strictEqual(status.authorizationFlow, "oauth-v2-pkce-rotating-bot-token");
    assert.strictEqual(status.channelAccess, "public-channels-app-is-member-of");
    assert.deepStrictEqual(READ_ONLY_SCOPES, ["channels:read", "channels:history"]);
    assert.strictEqual(MAX_HISTORY_MESSAGES, 15);
    assert.strictEqual(
      publicSlackStatus({ ...env, SLACK_TOKEN_ROTATION_VERIFIED: "false" }).configured,
      false
    );

    const state = "s".repeat(43);
    const verifier = createPkceVerifier();
    const challenge = createPkceChallenge(verifier);
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);

    const authorize = new URL(buildAuthorizationUrl({
      state,
      codeChallenge: challenge,
      env
    }));
    assert.strictEqual(authorize.origin + authorize.pathname, AUTHORIZE_URL);
    assert.strictEqual(authorize.searchParams.get("client_id"), env.SLACK_CLIENT_ID);
    assert.strictEqual(authorize.searchParams.get("redirect_uri"), env.SLACK_REDIRECT_URL);
    assert.strictEqual(authorize.searchParams.get("scope"), READ_ONLY_SCOPES.join(","));
    assert.strictEqual(authorize.searchParams.get("state"), state);
    assert.strictEqual(authorize.searchParams.get("code_challenge"), challenge);
    assert.strictEqual(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.strictEqual(authorize.searchParams.has("client_secret"), false);
    assert.strictEqual(authorize.toString().includes(verifier), false);

    let exchangeRequest = null;
    const exchanged = await exchangeAuthorizationCode({
      code: "temporary-slack-code",
      codeVerifier: verifier,
      env,
      fetchImpl: async (url, options) => {
        exchangeRequest = { url, options };
        return slackResponse(200, {
          ok: true,
          access_token: "xoxb-access-one",
          refresh_token: "xoxe-refresh-one",
          expires_in: 43200,
          token_type: "bot",
          scope: READ_ONLY_SCOPES.join(","),
          bot_user_id: "U12345678",
          app_id: "A12345678",
          team: { id: "T12345678", name: "UNBOUND Test Workspace" }
        });
      }
    });
    assert.strictEqual(exchangeRequest.url, TOKEN_URL);
    assert.strictEqual(exchangeRequest.options.redirect, "error");
    const exchangeBody = new URLSearchParams(exchangeRequest.options.body);
    assert.strictEqual(exchangeBody.get("client_id"), env.SLACK_CLIENT_ID);
    assert.strictEqual(exchangeBody.get("code"), "temporary-slack-code");
    assert.strictEqual(exchangeBody.get("code_verifier"), verifier);
    assert.strictEqual(exchangeBody.get("redirect_uri"), env.SLACK_REDIRECT_URL);
    assert.strictEqual(exchangeBody.get("grant_type"), "authorization_code");
    assert.strictEqual(exchangeBody.has("client_secret"), false);
    assert.strictEqual(exchanged.tokens.accessToken, "xoxb-access-one");
    assert.strictEqual(exchanged.tokens.refreshToken, "xoxe-refresh-one");
    assert.ok(exchanged.tokens.expiresAt);
    assert.ok(exchanged.tokens.refreshTokenExpiresAt);
    assert.strictEqual(exchanged.installation.teamId, "T12345678");

    let refreshRequest = null;
    const refreshed = await refreshUserToken({
      refreshToken: "xoxe-refresh-one",
      env,
      fetchImpl: async (url, options) => {
        refreshRequest = { url, options };
        return slackResponse(200, {
          ok: true,
          access_token: "xoxb-access-two",
          refresh_token: "xoxe-refresh-two",
          expires_in: 43200,
          token_type: "bot"
        });
      }
    });
    assert.strictEqual(refreshRequest.url, TOKEN_URL);
    const refreshBody = new URLSearchParams(refreshRequest.options.body);
    assert.strictEqual(refreshBody.get("client_id"), env.SLACK_CLIENT_ID);
    assert.strictEqual(refreshBody.get("grant_type"), "refresh_token");
    assert.strictEqual(refreshBody.get("refresh_token"), "xoxe-refresh-one");
    assert.strictEqual(refreshBody.has("client_secret"), false);
    assert.strictEqual(refreshed.accessToken, "xoxb-access-two");
    assert.strictEqual(refreshed.refreshToken, "xoxe-refresh-two");

    const workspace = await getAuthenticatedWorkspace({
      accessToken: "xoxb-access-two",
      fetchImpl: async (url, options) => {
        assert.strictEqual(url, API_ORIGIN + "/auth.test");
        assert.strictEqual(options.headers.Authorization, "Bearer xoxb-access-two");
        return slackResponse(200, {
          ok: true,
          team_id: "T12345678",
          team: "UNBOUND Test Workspace",
          user_id: "U12345678",
          bot_id: "B12345678",
          url: "https://example.slack.com/"
        });
      }
    });
    assert.deepStrictEqual(
      { id: workspace.id, login: workspace.login },
      { id: "T12345678", login: "UNBOUND Test Workspace" }
    );

    const channels = await listPublicChannels({
      accessToken: "xoxb-access-two",
      fetchImpl: async (url, options) => {
        assert(String(url).startsWith(API_ORIGIN + "/conversations.list?"));
        assert.strictEqual(options.headers.Authorization, "Bearer xoxb-access-two");
        const parsed = new URL(url);
        assert.strictEqual(parsed.searchParams.get("types"), "public_channel");
        assert.strictEqual(parsed.searchParams.get("exclude_archived"), "true");
        return slackResponse(200, {
          ok: true,
          channels: [
            {
              id: "C12345678",
              name: "general",
              is_member: true,
              is_archived: false,
              topic: { value: "Company updates" },
              purpose: { value: "Public announcements" }
            },
            {
              id: "C87654321",
              name: "archived",
              is_member: true,
              is_archived: true
            }
          ],
          response_metadata: { next_cursor: "" }
        });
      }
    });
    assert.strictEqual(channels.channels.length, 1);
    assert.strictEqual(channels.channels[0].name, "general");

    const history = await listChannelHistory({
      accessToken: "xoxb-access-two",
      channelId: "C12345678",
      fetchImpl: async (url, options) => {
        assert(String(url).startsWith(API_ORIGIN + "/conversations.history?"));
        assert.strictEqual(options.headers.Authorization, "Bearer xoxb-access-two");
        const parsed = new URL(url);
        assert.strictEqual(parsed.searchParams.get("channel"), "C12345678");
        assert.strictEqual(parsed.searchParams.get("limit"), "15");
        return slackResponse(200, {
          ok: true,
          messages: [
            { ts: "1758220000.000100", user: "U12345678", text: "Read-only test message" }
          ],
          has_more: false
        });
      }
    });
    assert.strictEqual(history.messages.length, 1);
    assert.strictEqual(history.messages[0].text, "Read-only test message");

    let revokeRequest = null;
    const revoked = await revokeUserToken({
      accessToken: "xoxb-access-two",
      fetchImpl: async (url, options) => {
        revokeRequest = { url, options };
        return slackResponse(200, { ok: true, revoked: true });
      }
    });
    assert.strictEqual(revokeRequest.url, API_ORIGIN + "/auth.revoke");
    assert.strictEqual(revoked.revoked, true);

    const connectors = connectorCatalog(env);
    const slackConnector = connectors.find((item) => item.id === "slack");
    assert(slackConnector);
    assert.strictEqual(slackConnector.configured, true);
    assert.strictEqual(slackConnector.read, true);
    assert.strictEqual(slackConnector.write, false);
    assert.strictEqual(slackConnector.dataAccess, "public-channel-read-only");

    const routes = fs.readFileSync(path.join(__dirname, "..", "connections", "routes.js"), "utf8");
    assert(routes.includes('"/slack/authorize"'));
    assert(routes.includes('"/slack/callback"'));
    assert(routes.includes('"/slack/channels"'));
    assert(routes.includes('"/slack/history"'));
    assert(routes.includes('router.delete("/slack"'));
    assert(routes.includes('connectionSecretAad("slack"'));
    assert(routes.includes("saveStoredTokens("));

    const page = fs.readFileSync(path.join(__dirname, "..", "connected-apps.html"), "utf8");
    assert(page.includes("Slack"));
    assert(page.includes('id="slackBadge"'));
    assert(page.includes("/api/connections/slack/authorize"));
    assert(page.includes("/api/connections/slack/channels"));
    assert(page.includes("/api/connections/slack/history"));
    assert(page.includes("channels:read"));
    assert(page.includes("channels:history"));
    assert(!page.includes("SLACK_CLIENT_SECRET"));
    assert(!page.includes("CONNECTED_APPS_TOKEN_KEY"));

    console.log("PASS Slack Connected Apps: PKCE, rotating token storage, public-channel read-only scopes, bounded history, revocation, registry readiness, routes, and secret-safe UI.");
  } finally {
    if (originalKey === undefined) delete process.env.CONNECTED_APPS_TOKEN_KEY;
    else process.env.CONNECTED_APPS_TOKEN_KEY = originalKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
