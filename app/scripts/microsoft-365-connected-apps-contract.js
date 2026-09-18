const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  IDENTITY_ORIGIN,
  GRAPH_ORIGIN,
  READ_ONLY_SCOPES,
  MAX_MAIL_MESSAGES,
  MAX_CALENDAR_EVENTS,
  MAX_DRIVE_ITEMS,
  createPkceChallenge,
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
} = require("../connections/providers/microsoft-365");
const { createPkceVerifier } = require("../connections/routes");
const { connectorCatalog } = require("../platform/registry");

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

async function main() {
  const originalKey = process.env.CONNECTED_APPS_TOKEN_KEY;
  process.env.CONNECTED_APPS_TOKEN_KEY = Buffer.alloc(32, 43).toString("base64");

  const env = {
    CONNECTED_APPS_TOKEN_KEY: process.env.CONNECTED_APPS_TOKEN_KEY,
    MICROSOFT_OAUTH_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
    MICROSOFT_OAUTH_CLIENT_SECRET: "server-only-microsoft-secret",
    MICROSOFT_OAUTH_CALLBACK_URL: "https://unbound.example/api/connections/microsoft/callback",
    MICROSOFT_OAUTH_TENANT: "common",
    MICROSOFT_OAUTH_REGISTRATION_VERIFIED: "true",
    MICROSOFT_OAUTH_READ_ONLY_SCOPES_VERIFIED: "true",
    MICROSOFT_OAUTH_FILE_READ_SCOPE_VERIFIED: "true"
  };

  try {
    const status = publicMicrosoft365Status(env);
    assert.strictEqual(status.configured, true);
    assert.strictEqual(status.mail, "Mail.ReadBasic");
    assert.strictEqual(status.calendar, "Calendars.ReadBasic");
    assert.strictEqual(status.files, "Files.Read");
    assert.strictEqual(status.mailBodyAccessRequested, false);
    assert.strictEqual(status.calendarBodyAccessRequested, false);
    assert.strictEqual(status.oneDriveContentEndpointEnabled, false);
    assert.strictEqual(status.writeActionsEnabled, false);
    assert.strictEqual(
      publicMicrosoft365Status({ ...env, MICROSOFT_OAUTH_FILE_READ_SCOPE_VERIFIED: "false" }).configured,
      false
    );

    assert.deepStrictEqual(READ_ONLY_SCOPES, [
      "openid",
      "profile",
      "email",
      "offline_access",
      "https://graph.microsoft.com/User.Read",
      "https://graph.microsoft.com/Mail.ReadBasic",
      "https://graph.microsoft.com/Calendars.ReadBasic",
      "https://graph.microsoft.com/Files.Read"
    ]);
    assert.strictEqual(MAX_MAIL_MESSAGES, 25);
    assert.strictEqual(MAX_CALENDAR_EVENTS, 50);
    assert.strictEqual(MAX_DRIVE_ITEMS, 50);

    assert.strictEqual(
      authorizationEndpoint(env),
      IDENTITY_ORIGIN + "/common/oauth2/v2.0/authorize"
    );
    assert.strictEqual(
      tokenEndpoint(env),
      IDENTITY_ORIGIN + "/common/oauth2/v2.0/token"
    );

    const state = "m".repeat(43);
    const verifier = createPkceVerifier();
    const challenge = createPkceChallenge(verifier);
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);

    const authorize = new URL(buildAuthorizationUrl({
      state,
      codeChallenge: challenge,
      env
    }));
    assert.strictEqual(authorize.toString().startsWith(IDENTITY_ORIGIN + "/common/oauth2/v2.0/authorize"), true);
    assert.strictEqual(authorize.searchParams.get("client_id"), env.MICROSOFT_OAUTH_CLIENT_ID);
    assert.strictEqual(authorize.searchParams.get("response_type"), "code");
    assert.strictEqual(authorize.searchParams.get("redirect_uri"), env.MICROSOFT_OAUTH_CALLBACK_URL);
    assert.strictEqual(authorize.searchParams.get("response_mode"), "query");
    assert.strictEqual(authorize.searchParams.get("state"), state);
    assert.strictEqual(authorize.searchParams.get("code_challenge"), challenge);
    assert.strictEqual(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.strictEqual(authorize.searchParams.has("client_secret"), false);
    assert.strictEqual(authorize.toString().includes(verifier), false);
    for (const scope of READ_ONLY_SCOPES) {
      assert(authorize.searchParams.get("scope").split(" ").includes(scope));
    }

    let exchangeRequest = null;
    const exchanged = await exchangeAuthorizationCode({
      code: "temporary-microsoft-code",
      codeVerifier: verifier,
      env,
      fetchImpl: async (url, options) => {
        exchangeRequest = { url, options };
        return jsonResponse(200, {
          token_type: "Bearer",
          scope: READ_ONLY_SCOPES.join(" "),
          expires_in: 3600,
          access_token: "microsoft-access-one",
          refresh_token: "microsoft-refresh-one"
        });
      }
    });
    assert.strictEqual(exchangeRequest.url, tokenEndpoint(env));
    assert.strictEqual(exchangeRequest.options.redirect, "error");
    const exchangeBody = new URLSearchParams(exchangeRequest.options.body);
    assert.strictEqual(exchangeBody.get("client_id"), env.MICROSOFT_OAUTH_CLIENT_ID);
    assert.strictEqual(exchangeBody.get("client_secret"), env.MICROSOFT_OAUTH_CLIENT_SECRET);
    assert.strictEqual(exchangeBody.get("code"), "temporary-microsoft-code");
    assert.strictEqual(exchangeBody.get("code_verifier"), verifier);
    assert.strictEqual(exchangeBody.get("redirect_uri"), env.MICROSOFT_OAUTH_CALLBACK_URL);
    assert.strictEqual(exchangeBody.get("grant_type"), "authorization_code");
    assert.strictEqual(exchanged.accessToken, "microsoft-access-one");
    assert.strictEqual(exchanged.refreshToken, "microsoft-refresh-one");
    assert.ok(exchanged.expiresAt);

    let refreshRequest = null;
    const refreshed = await refreshUserToken({
      refreshToken: "microsoft-refresh-one",
      env,
      fetchImpl: async (url, options) => {
        refreshRequest = { url, options };
        return jsonResponse(200, {
          token_type: "Bearer",
          expires_in: 3600,
          access_token: "microsoft-access-two"
        });
      }
    });
    assert.strictEqual(refreshRequest.url, tokenEndpoint(env));
    const refreshBody = new URLSearchParams(refreshRequest.options.body);
    assert.strictEqual(refreshBody.get("client_secret"), env.MICROSOFT_OAUTH_CLIENT_SECRET);
    assert.strictEqual(refreshBody.get("grant_type"), "refresh_token");
    assert.strictEqual(refreshBody.get("refresh_token"), "microsoft-refresh-one");
    assert.strictEqual(refreshed.accessToken, "microsoft-access-two");
    assert.strictEqual(refreshed.refreshToken, "microsoft-refresh-one");

    const user = await getAuthenticatedUser({
      accessToken: "microsoft-access-two",
      fetchImpl: async (url, options) => {
        const parsed = new URL(url);
        assert.strictEqual(parsed.origin + parsed.pathname, GRAPH_ORIGIN + "/me");
        assert.strictEqual(parsed.searchParams.get("$select"), "id,displayName,mail,userPrincipalName");
        assert.strictEqual(options.headers.Authorization, "Bearer microsoft-access-two");
        return jsonResponse(200, {
          id: "user-123",
          displayName: "Example Person",
          mail: "person@example.com",
          userPrincipalName: "person@example.com"
        });
      }
    });
    assert.deepStrictEqual(
      { id: user.id, login: user.login },
      { id: "user-123", login: "person@example.com" }
    );

    const mail = await listMailMetadata({
      accessToken: "microsoft-access-two",
      fetchImpl: async (url, options) => {
        const parsed = new URL(url);
        assert.strictEqual(parsed.origin + parsed.pathname, GRAPH_ORIGIN + "/me/messages");
        assert.strictEqual(parsed.searchParams.get("$top"), "25");
        assert.strictEqual(parsed.searchParams.get("$orderby"), "receivedDateTime desc");
        assert(parsed.searchParams.get("$select").includes("subject"));
        assert.strictEqual(parsed.searchParams.get("$select").includes("body"), false);
        assert.strictEqual(options.headers.Authorization, "Bearer microsoft-access-two");
        return jsonResponse(200, {
          value: [{
            id: "message-1",
            subject: "Test subject",
            from: { emailAddress: { address: "sender@example.com" } },
            toRecipients: [{ emailAddress: { address: "person@example.com" } }],
            receivedDateTime: "2026-09-18T18:00:00Z",
            isRead: false,
            webLink: "https://outlook.office.com/mail/id/message-1",
            body: { content: "MUST NOT RETURN" },
            bodyPreview: "MUST NOT RETURN"
          }]
        });
      }
    });
    assert.strictEqual(mail.messages.length, 1);
    assert.strictEqual(mail.messages[0].subject, "Test subject");
    assert.strictEqual(mail.messages[0].from, "sender@example.com");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(mail.messages[0], "body"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(mail.messages[0], "bodyPreview"), false);
    assert.strictEqual(JSON.stringify(mail).includes("MUST NOT RETURN"), false);

    const calendar = await listCalendarEvents({
      accessToken: "microsoft-access-two",
      startDateTime: "2026-09-18T00:00:00Z",
      endDateTime: "2026-10-18T00:00:00Z",
      fetchImpl: async (url, options) => {
        const parsed = new URL(url);
        assert.strictEqual(parsed.origin + parsed.pathname, GRAPH_ORIGIN + "/me/calendarView");
        assert.strictEqual(parsed.searchParams.get("$top"), "50");
        assert.strictEqual(parsed.searchParams.get("$orderby"), "start/dateTime");
        assert.strictEqual(parsed.searchParams.get("$select").includes("body"), false);
        assert.strictEqual(options.headers.Authorization, "Bearer microsoft-access-two");
        return jsonResponse(200, {
          value: [{
            id: "event-1",
            subject: "Appointment",
            start: { dateTime: "2026-09-19T09:00:00", timeZone: "Mountain Standard Time" },
            end: { dateTime: "2026-09-19T10:00:00", timeZone: "Mountain Standard Time" },
            location: { displayName: "Office" },
            isAllDay: false,
            webLink: "https://outlook.office.com/calendar/item/event-1",
            body: { content: "MUST NOT RETURN" }
          }]
        });
      }
    });
    assert.strictEqual(calendar.events.length, 1);
    assert.strictEqual(calendar.events[0].subject, "Appointment");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(calendar.events[0], "body"), false);
    assert.strictEqual(JSON.stringify(calendar).includes("MUST NOT RETURN"), false);

    const drive = await listOneDriveMetadata({
      accessToken: "microsoft-access-two",
      fetchImpl: async (url, options) => {
        const parsed = new URL(url);
        assert.strictEqual(parsed.origin + parsed.pathname, GRAPH_ORIGIN + "/me/drive/root/children");
        assert.strictEqual(parsed.searchParams.get("$top"), "50");
        assert.strictEqual(parsed.searchParams.get("$select").includes("@microsoft.graph.downloadUrl"), false);
        assert.strictEqual(options.headers.Authorization, "Bearer microsoft-access-two");
        return jsonResponse(200, {
          value: [{
            id: "drive-item-1",
            name: "report.pdf",
            size: 12345,
            lastModifiedDateTime: "2026-09-17T19:00:00Z",
            webUrl: "https://example-my.sharepoint.com/report.pdf",
            file: { mimeType: "application/pdf", hashes: { quickXorHash: "ignored" } },
            parentReference: { path: "/drive/root:" },
            content: "MUST NOT RETURN"
          }]
        });
      }
    });
    assert.strictEqual(drive.items.length, 1);
    assert.strictEqual(drive.items[0].name, "report.pdf");
    assert.strictEqual(drive.items[0].mimeType, "application/pdf");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(drive.items[0], "content"), false);
    assert.strictEqual(JSON.stringify(drive).includes("MUST NOT RETURN"), false);

    const connectors = connectorCatalog(env);
    const microsoftConnector = connectors.find((item) => item.id === "microsoft_365");
    assert(microsoftConnector);
    assert.strictEqual(microsoftConnector.configured, true);
    assert.strictEqual(microsoftConnector.read, true);
    assert.strictEqual(microsoftConnector.write, false);
    assert.strictEqual(
      microsoftConnector.dataAccess,
      "basic-mail-calendar-plus-onedrive-metadata"
    );

    const routes = fs.readFileSync(path.join(__dirname, "..", "connections", "routes.js"), "utf8");
    assert(routes.includes('"/microsoft/authorize"'));
    assert(routes.includes('"/microsoft/callback"'));
    assert(routes.includes('"/microsoft/mail"'));
    assert(routes.includes('"/microsoft/calendar"'));
    assert(routes.includes('"/microsoft/drive"'));
    assert(routes.includes('router.delete("/microsoft"'));
    assert(routes.includes('connectionSecretAad("microsoft_365"'));
    assert(routes.includes("saveStoredTokens("));

    const page = fs.readFileSync(path.join(__dirname, "..", "connected-apps.html"), "utf8");
    assert(page.includes("Microsoft 365"));
    assert(page.includes('id="microsoftBadge"'));
    assert(page.includes("/api/connections/microsoft/authorize"));
    assert(page.includes("/api/connections/microsoft/mail"));
    assert(page.includes("/api/connections/microsoft/calendar"));
    assert(page.includes("/api/connections/microsoft/drive"));
    assert(page.includes("Mail.ReadBasic"));
    assert(page.includes("Calendars.ReadBasic"));
    assert(page.includes("Files.Read"));
    assert(!page.includes("MICROSOFT_OAUTH_CLIENT_SECRET"));
    assert(!page.includes("CONNECTED_APPS_TOKEN_KEY"));

    console.log("PASS Microsoft 365 Connected Apps: PKCE confidential-web OAuth, basic mail/calendar reads, OneDrive metadata-only endpoint, encrypted refresh support, local disconnect, registry readiness, and secret-safe UI.");
  } finally {
    if (originalKey === undefined) delete process.env.CONNECTED_APPS_TOKEN_KEY;
    else process.env.CONNECTED_APPS_TOKEN_KEY = originalKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
