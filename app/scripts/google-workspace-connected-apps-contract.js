const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  AUTHORIZE_URL,
  TOKEN_URL,
  REVOKE_URL,
  USERINFO_URL,
  GMAIL_API_ORIGIN,
  CALENDAR_API_ORIGIN,
  DRIVE_API_ORIGIN,
  READ_ONLY_SCOPES,
  createPkceChallenge,
  publicGoogleWorkspaceStatus,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshUserToken,
  revokeUserToken,
  getAuthenticatedUser,
  listGmailMetadata,
  listCalendarEvents,
  listDriveMetadata
} = require("../connections/providers/google-workspace");
const { createPkceVerifier } = require("../connections/routes");
const { providerCatalog } = require("../platform/registry");

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); }
  };
}

async function main() {
  const originalKey = process.env.CONNECTED_APPS_TOKEN_KEY;
  process.env.CONNECTED_APPS_TOKEN_KEY = Buffer.alloc(32, 17).toString("base64");

  const env = {
    CONNECTED_APPS_TOKEN_KEY: process.env.CONNECTED_APPS_TOKEN_KEY,
    GOOGLE_OAUTH_CLIENT_ID: "google-client-id.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "server-only-google-secret",
    GOOGLE_OAUTH_CALLBACK_URL: "https://unbound.example/api/connections/google/callback",
    GOOGLE_OAUTH_REGISTRATION_VERIFIED: "true",
    GOOGLE_OAUTH_READ_ONLY_SCOPES_VERIFIED: "true"
  };

  try {
    const status = publicGoogleWorkspaceStatus(env);
    assert.strictEqual(status.configured, true);
    assert.strictEqual(status.metadataOnly, true);
    assert.strictEqual(status.gmail, "metadata");
    assert.strictEqual(status.calendar, "events-readonly");
    assert.strictEqual(status.drive, "metadata-readonly");
    assert.strictEqual(status.writeActionsEnabled, false);
    assert.strictEqual(
      publicGoogleWorkspaceStatus({ ...env, GOOGLE_OAUTH_READ_ONLY_SCOPES_VERIFIED: "false" }).configured,
      false
    );

    assert.deepStrictEqual(READ_ONLY_SCOPES, [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.metadata",
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly"
    ]);
    assert.strictEqual(
      READ_ONLY_SCOPES.some((scope) => /gmail\.readonly|drive\.readonly|calendar(?!\.events\.readonly)/.test(scope)),
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
    assert.strictEqual(authorize.toString().startsWith(AUTHORIZE_URL), true);
    assert.strictEqual(authorize.searchParams.get("client_id"), env.GOOGLE_OAUTH_CLIENT_ID);
    assert.strictEqual(authorize.searchParams.get("redirect_uri"), env.GOOGLE_OAUTH_CALLBACK_URL);
    assert.strictEqual(authorize.searchParams.get("response_type"), "code");
    assert.strictEqual(authorize.searchParams.get("state"), state);
    assert.strictEqual(authorize.searchParams.get("code_challenge"), challenge);
    assert.strictEqual(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.strictEqual(authorize.searchParams.get("access_type"), "offline");
    assert.strictEqual(authorize.searchParams.get("include_granted_scopes"), "true");
    assert.strictEqual(authorize.searchParams.get("prompt"), "consent");
    for (const scope of READ_ONLY_SCOPES) {
      assert(authorize.searchParams.get("scope").split(" ").includes(scope));
    }
    assert.strictEqual(authorize.searchParams.has("client_secret"), false);
    assert.strictEqual(authorize.toString().includes(verifier), false);

    let exchangeRequest = null;
    const exchanged = await exchangeAuthorizationCode({
      code: "temporary-google-code",
      codeVerifier: verifier,
      env,
      fetchImpl: async (url, options) => {
        exchangeRequest = { url, options };
        return jsonResponse(200, {
          access_token: "google-access-one",
          expires_in: 3600,
          refresh_token: "google-refresh-one",
          token_type: "Bearer"
        });
      }
    });
    assert.strictEqual(exchangeRequest.url, TOKEN_URL);
    assert.strictEqual(exchangeRequest.options.redirect, "error");
    const exchangeBody = new URLSearchParams(exchangeRequest.options.body);
    assert.strictEqual(exchangeBody.get("client_id"), env.GOOGLE_OAUTH_CLIENT_ID);
    assert.strictEqual(exchangeBody.get("client_secret"), env.GOOGLE_OAUTH_CLIENT_SECRET);
    assert.strictEqual(exchangeBody.get("code_verifier"), verifier);
    assert.strictEqual(exchangeBody.get("grant_type"), "authorization_code");
    assert.strictEqual(exchanged.accessToken, "google-access-one");
    assert.strictEqual(exchanged.refreshToken, "google-refresh-one");
    assert.ok(exchanged.expiresAt);

    let refreshRequest = null;
    const refreshed = await refreshUserToken({
      refreshToken: "google-refresh-one",
      env,
      fetchImpl: async (url, options) => {
        refreshRequest = { url, options };
        return jsonResponse(200, {
          access_token: "google-access-two",
          expires_in: 3600,
          token_type: "Bearer"
        });
      }
    });
    assert.strictEqual(refreshRequest.url, TOKEN_URL);
    const refreshBody = new URLSearchParams(refreshRequest.options.body);
    assert.strictEqual(refreshBody.get("grant_type"), "refresh_token");
    assert.strictEqual(refreshBody.get("refresh_token"), "google-refresh-one");
    assert.strictEqual(refreshed.accessToken, "google-access-two");
    assert.strictEqual(refreshed.refreshToken, "google-refresh-one");

    const user = await getAuthenticatedUser({
      accessToken: "google-access-two",
      fetchImpl: async (url, options) => {
        assert.strictEqual(url, USERINFO_URL);
        assert.strictEqual(options.headers.Authorization, "Bearer google-access-two");
        return jsonResponse(200, {
          sub: "google-user-123",
          email: "person@example.com",
          name: "Example Person",
          picture: "https://example.com/avatar.png"
        });
      }
    });
    assert.deepStrictEqual(
      { id: user.id, login: user.login },
      { id: "google-user-123", login: "person@example.com" }
    );

    const gmailCalls = [];
    const gmail = await listGmailMetadata({
      accessToken: "google-access-two",
      query: "newer_than:7d",
      fetchImpl: async (url, options) => {
        gmailCalls.push({ url: String(url), options });
        assert.strictEqual(options.headers.Authorization, "Bearer google-access-two");
        if (gmailCalls.length === 1) {
          assert(String(url).startsWith(GMAIL_API_ORIGIN + "/users/me/messages?"));
          const parsed = new URL(url);
          assert.strictEqual(parsed.searchParams.get("q"), "newer_than:7d");
          return jsonResponse(200, {
            messages: [{ id: "m1", threadId: "t1" }],
            resultSizeEstimate: 1
          });
        }
        const parsed = new URL(url);
        assert.strictEqual(parsed.pathname, "/gmail/v1/users/me/messages/m1");
        assert.strictEqual(parsed.searchParams.get("format"), "metadata");
        assert.deepStrictEqual(
          parsed.searchParams.getAll("metadataHeaders"),
          ["From", "To", "Subject", "Date"]
        );
        return jsonResponse(200, {
          id: "m1",
          threadId: "t1",
          labelIds: ["INBOX", "UNREAD"],
          snippet: "THIS MUST NOT BE RETURNED",
          payload: {
            body: { data: "THIS MUST NOT BE RETURNED" },
            headers: [
              { name: "From", value: "sender@example.com" },
              { name: "To", value: "person@example.com" },
              { name: "Subject", value: "Test subject" },
              { name: "Date", value: "Fri, 18 Sep 2026 12:00:00 -0600" }
            ]
          }
        });
      }
    });
    assert.strictEqual(gmail.messages.length, 1);
    assert.strictEqual(gmail.messages[0].subject, "Test subject");
    assert.strictEqual(gmail.messages[0].from, "sender@example.com");
    assert.strictEqual(JSON.stringify(gmail).includes("THIS MUST NOT BE RETURNED"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(gmail.messages[0], "snippet"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(gmail.messages[0], "body"), false);

    const calendar = await listCalendarEvents({
      accessToken: "google-access-two",
      timeMin: "2026-09-18T00:00:00Z",
      fetchImpl: async (url, options) => {
        assert(String(url).startsWith(CALENDAR_API_ORIGIN + "/calendars/primary/events?"));
        assert.strictEqual(options.headers.Authorization, "Bearer google-access-two");
        const parsed = new URL(url);
        assert.strictEqual(parsed.searchParams.get("singleEvents"), "true");
        assert.strictEqual(parsed.searchParams.get("orderBy"), "startTime");
        return jsonResponse(200, {
          items: [{
            id: "event-1",
            status: "confirmed",
            summary: "Appointment",
            description: "NOT RETURNED",
            location: "Office",
            start: { dateTime: "2026-09-19T09:00:00-06:00" },
            end: { dateTime: "2026-09-19T10:00:00-06:00" },
            htmlLink: "https://calendar.google.com/event?eid=1",
            eventType: "default"
          }]
        });
      }
    });
    assert.strictEqual(calendar.events[0].summary, "Appointment");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(calendar.events[0], "description"), false);

    const drive = await listDriveMetadata({
      accessToken: "google-access-two",
      query: "report",
      fetchImpl: async (url, options) => {
        assert(String(url).startsWith(DRIVE_API_ORIGIN + "/files?"));
        assert.strictEqual(options.headers.Authorization, "Bearer google-access-two");
        const parsed = new URL(url);
        assert(parsed.searchParams.get("q").includes("name contains"));
        assert(parsed.searchParams.get("fields").includes("files(id,name,mimeType,modifiedTime,webViewLink"));
        assert.strictEqual(parsed.searchParams.get("alt"), null);
        return jsonResponse(200, {
          files: [{
            id: "file-1",
            name: "report.pdf",
            mimeType: "application/pdf",
            modifiedTime: "2026-09-17T19:00:00Z",
            webViewLink: "https://drive.google.com/file/d/file-1/view",
            owners: [{ displayName: "Example Person", emailAddress: "person@example.com" }],
            content: "NOT RETURNED"
          }]
        });
      }
    });
    assert.strictEqual(drive.files[0].name, "report.pdf");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(drive.files[0], "content"), false);

    let revokeRequest = null;
    const revoked = await revokeUserToken({
      accessToken: "short-access",
      refreshToken: "long-refresh",
      fetchImpl: async (url, options) => {
        revokeRequest = { url, options };
        return { ok: true, status: 200 };
      }
    });
    assert.strictEqual(revokeRequest.url, REVOKE_URL);
    assert.strictEqual(new URLSearchParams(revokeRequest.options.body).get("token"), "long-refresh");
    assert.strictEqual(revoked.revoked, true);

    const connectors = providerCatalog(env);
    const googleConnector = connectors.find((item) => item.id === "google");
    assert(googleConnector);

    const routes = fs.readFileSync(path.join(__dirname, "..", "connections", "routes.js"), "utf8");
    assert(routes.includes('"/google/authorize"'));
    assert(routes.includes('"/google/callback"'));
    assert(routes.includes('"/google/mail"'));
    assert(routes.includes('"/google/calendar"'));
    assert(routes.includes('"/google/drive"'));
    assert(routes.includes('router.delete("/google"'));
    assert(routes.includes('connectionSecretAad("google_workspace"'));
    assert(routes.includes('saveStoredTokens('));
    assert(!routes.includes("GOOGLE_OAUTH_CLIENT_SECRET"));

    const page = fs.readFileSync(path.join(__dirname, "..", "connected-apps.html"), "utf8");
    assert(page.includes("Google Workspace"));
    assert(page.includes('id="googleBadge"'));
    assert(page.includes("/api/connections/google/authorize"));
    assert(page.includes("/api/connections/google/mail"));
    assert(page.includes("/api/connections/google/calendar"));
    assert(page.includes("/api/connections/google/drive"));
    assert(page.includes("Message bodies, file contents, and write actions are not requested"));
    assert(!page.includes("GOOGLE_OAUTH_CLIENT_SECRET"));
    assert(!page.includes("CONNECTED_APPS_TOKEN_KEY"));

    console.log("PASS Google Workspace Connected Apps: PKCE/offline OAuth, minimum read-only scopes, refresh preservation, metadata-only Gmail/Calendar/Drive, revocation, and secret-safe UI.");
  } finally {
    if (originalKey === undefined) delete process.env.CONNECTED_APPS_TOKEN_KEY;
    else process.env.CONNECTED_APPS_TOKEN_KEY = originalKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
