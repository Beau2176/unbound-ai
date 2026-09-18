const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  getTokenVaultStatus,
  encryptSecret,
  decryptSecret
} = require("../connections/token-vault");
const {
  SUPPORTED_CONNECTED_APP_PROVIDERS,
  normalizeProviderId,
  secretAad: connectionSecretAad
} = require("../connections/store");
const {
  API_VERSION,
  normalizeCodeVerifier,
  createPkceChallenge,
  publicGitHubStatus,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshUserToken,
  revokeUserToken,
  getAuthenticatedUser,
  listAuthorizedRepositories
} = require("../connections/providers/github");
const { stateHash, createPkceVerifier } = require("../connections/routes");
const {
  integrateConnectedAppsServerSource
} = require("../connections/server-integration");
const { CAPABILITY_CATALOG, buildCapabilityAccess } = require("../access/entitlements");
const { integrateEmailVerificationServerSource } = require("../email/server-integration");
const { integrateBillingServerSource } = require("../billing/server-integration");
const { integrateFileAnalysisServerSource } = require("../files/server-integration");
const { integrateImageUnderstandingServerSource } = require("../images/server-integration");
const { integrateVoiceServerSource } = require("../voice/server-integration");
const { integrateCommandCenterServerSource } = require("../command-center/server-integration");
const { integrateScheduledTasksServerSource } = require("../tasks/server-integration");
const { integrateAgentServerSource } = require("../agents/server-integration");
const { integrateMemoryServerSource } = require("../memory/server-integration");
const { integrateModeLibraryServerSource } = require("../preferences/mode-server-integration");
const { integrateAdvertisingAnalyticsServerSource } = require("../advertising/server-integration");
const { integrateAdvertisingPolicyServerSource } = require("../advertising/policy-server-integration");
const { integrateModelRoutingServerSource } = require("../ai/model-routing-server-integration");

const appRoot = path.resolve(__dirname, "..");

function mockJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

async function main() {
  const key = Buffer.alloc(32, 7).toString("base64");
  const env = {
    CONNECTED_APPS_TOKEN_KEY: key,
    GITHUB_APP_CLIENT_ID: "Iv1.test-client-id",
    GITHUB_APP_CLIENT_SECRET: "server-only-client-secret",
    GITHUB_APP_CALLBACK_URL: "https://unbound.example/api/connections/github/callback",
    GITHUB_APP_REGISTRATION_VERIFIED: "true",
    GITHUB_APP_READ_ONLY_PERMISSIONS_VERIFIED: "true"
  };

  assert.strictEqual(getTokenVaultStatus({}).configured, false);
  assert.strictEqual(getTokenVaultStatus(env).configured, true);
  assert.ok(SUPPORTED_CONNECTED_APP_PROVIDERS.includes("github"));
  assert.ok(SUPPORTED_CONNECTED_APP_PROVIDERS.includes("google_workspace"));
  assert.ok(SUPPORTED_CONNECTED_APP_PROVIDERS.includes("microsoft_365"));
  assert.ok(SUPPORTED_CONNECTED_APP_PROVIDERS.includes("slack"));
  assert.strictEqual(normalizeProviderId("SLACK"), "slack");
  assert.strictEqual(normalizeProviderId("unknown"), null);
  assert.strictEqual(connectionSecretAad("github", 42, "access"), "unbound:github:42:access");
  const encrypted = encryptSecret("ghu_secret-token-value", { env, aad: "test-aad" });
  assert.ok(encrypted.startsWith("v1."));
  assert.ok(!encrypted.includes("ghu_secret-token-value"));
  assert.strictEqual(decryptSecret(encrypted, { env, aad: "test-aad" }), "ghu_secret-token-value");
  assert.throws(
    () => decryptSecret(`${encrypted.slice(0, -2)}xx`, { env, aad: "test-aad" }),
    (error) => String(error?.code || "").startsWith("CONNECTED_APPS_SECRET_")
  );
  assert.throws(
    () => decryptSecret(encrypted, { env, aad: "wrong-aad" }),
    (error) => error?.code === "CONNECTED_APPS_SECRET_AUTH_FAILED"
  );

  const status = publicGitHubStatus(env);
  assert.strictEqual(status.configured, true);
  assert.strictEqual(status.writeActionsEnabled, false);
  assert.strictEqual(status.authorizationFlow, "web-application-pkce");
  assert.strictEqual(status.apiVersion, "2026-03-10");
  assert.strictEqual(API_VERSION, "2026-03-10");
  assert.strictEqual(publicGitHubStatus({ ...env, GITHUB_APP_READ_ONLY_PERMISSIONS_VERIFIED: "false" }).configured, false);
  assert.strictEqual(publicGitHubStatus({ ...env, CONNECTED_APPS_TOKEN_KEY: "" }).configured, false);

  const state = "a".repeat(43);
  const verifier = createPkceVerifier();
  assert.ok(normalizeCodeVerifier(verifier));
  assert.strictEqual(normalizeCodeVerifier("too-short"), null);
  const challenge = createPkceChallenge(verifier);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  const authorizeUrl = new URL(buildAuthorizationUrl({ state, codeChallenge: challenge, env }));
  assert.strictEqual(authorizeUrl.origin, "https://github.com");
  assert.strictEqual(authorizeUrl.pathname, "/login/oauth/authorize");
  assert.strictEqual(authorizeUrl.searchParams.get("client_id"), env.GITHUB_APP_CLIENT_ID);
  assert.strictEqual(authorizeUrl.searchParams.get("state"), state);
  assert.strictEqual(authorizeUrl.searchParams.get("code_challenge"), challenge);
  assert.strictEqual(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.strictEqual(authorizeUrl.searchParams.has("client_secret"), false);
  assert.strictEqual(authorizeUrl.searchParams.has("code_verifier"), false);
  assert.strictEqual(stateHash(state).length, 64);
  assert.notStrictEqual(stateHash(state), state);

  let tokenExchangeBody = "";
  const exchanged = await exchangeAuthorizationCode({
    code: "temporary-code",
    codeVerifier: verifier,
    env,
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, "https://github.com/login/oauth/access_token");
      tokenExchangeBody = String(options.body || "");
      return mockJsonResponse(200, {
        access_token: "ghu_access_one",
        expires_in: 28800,
        refresh_token: "ghr_refresh_one",
        refresh_token_expires_in: 15897600,
        token_type: "bearer"
      });
    }
  });
  assert.strictEqual(exchanged.accessToken, "ghu_access_one");
  assert.strictEqual(exchanged.refreshToken, "ghr_refresh_one");
  assert.ok(exchanged.expiresAt);
  assert.ok(exchanged.refreshTokenExpiresAt);
  assert.ok(tokenExchangeBody.includes("client_secret=server-only-client-secret"));
  assert.ok(tokenExchangeBody.includes(`code_verifier=${encodeURIComponent(verifier)}`));
  assert.ok(!authorizeUrl.toString().includes("server-only-client-secret"));
  assert.ok(!authorizeUrl.toString().includes(verifier));
  await assert.rejects(
    exchangeAuthorizationCode({ code: "temporary-code", codeVerifier: "bad", env, fetchImpl: async () => mockJsonResponse(500, {}) }),
    (error) => error?.code === "GITHUB_PKCE_VERIFIER_INVALID"
  );

  const refreshed = await refreshUserToken({
    refreshToken: "ghr_refresh_one",
    env,
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, "https://github.com/login/oauth/access_token");
      assert.ok(String(options.body).includes("grant_type=refresh_token"));
      return mockJsonResponse(200, {
        access_token: "ghu_access_two",
        expires_in: 28800,
        refresh_token: "ghr_refresh_two",
        refresh_token_expires_in: 15897600,
        token_type: "bearer"
      });
    }
  });
  assert.strictEqual(refreshed.accessToken, "ghu_access_two");

  const user = await getAuthenticatedUser({
    accessToken: "ghu_access_two",
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, "https://api.github.com/user");
      assert.strictEqual(options.headers.Authorization, "Bearer ghu_access_two");
      assert.strictEqual(options.headers["X-GitHub-Api-Version"], "2026-03-10");
      return mockJsonResponse(200, {
        id: 12345,
        login: "unbound-owner",
        name: "UNBOUND Owner",
        avatar_url: "https://avatars.githubusercontent.com/u/12345",
        html_url: "https://github.com/unbound-owner"
      });
    }
  });
  assert.deepStrictEqual({ id: user.id, login: user.login }, { id: "12345", login: "unbound-owner" });

  const repositoryResult = await listAuthorizedRepositories({
    accessToken: "ghu_access_two",
    fetchImpl: async (url, options) => {
      assert.strictEqual(options.headers["X-GitHub-Api-Version"], "2026-03-10");
      if (String(url).includes("/user/installations?")) {
        return mockJsonResponse(200, {
          installations: [{ id: 222, account: { id: 12345, login: "unbound-owner", type: "User" }, repository_selection: "selected" }]
        });
      }
      if (String(url).includes("/user/installations/222/repositories?")) {
        return mockJsonResponse(200, {
          repositories: [{ id: 999, full_name: "unbound-owner/unbound-ai", private: true, archived: false, default_branch: "main", html_url: "https://github.com/unbound-owner/unbound-ai", updated_at: "2026-09-13T00:00:00Z" }]
        });
      }
      throw new Error(`Unexpected GitHub URL: ${url}`);
    }
  });
  assert.strictEqual(repositoryResult.installations.length, 1);
  assert.strictEqual(repositoryResult.repositories.length, 1);
  assert.strictEqual(repositoryResult.repositories[0].fullName, "unbound-owner/unbound-ai");

  let revokeAuthorization = "";
  const revoked = await revokeUserToken({
    accessToken: "ghu_access_two",
    env,
    fetchImpl: async (url, options) => {
      assert.strictEqual(url, `https://api.github.com/applications/${encodeURIComponent(env.GITHUB_APP_CLIENT_ID)}/token`);
      assert.strictEqual(options.method, "DELETE");
      assert.strictEqual(options.headers["X-GitHub-Api-Version"], "2026-03-10");
      revokeAuthorization = options.headers.Authorization;
      return { ok: true, status: 204, async json() { return {}; } };
    }
  });
  assert.strictEqual(revoked.revoked, true);
  assert.ok(revokeAuthorization.startsWith("Basic "));

  assert.strictEqual(CAPABILITY_CATALOG.connected_apps.implemented, true);
  assert.strictEqual(CAPABILITY_CATALOG.connected_apps.minimumPlan, "ultra");
  const free = buildCapabilityAccess({ planTier: "free" }).find((item) => item.key === "connected_apps");
  const premium = buildCapabilityAccess({ planTier: "premium" }).find((item) => item.key === "connected_apps");
  const ultra = buildCapabilityAccess({ planTier: "ultra" }).find((item) => item.key === "connected_apps");
  const legacyTop = buildCapabilityAccess({ planTier: "top" }).find((item) => item.key === "connected_apps");
  assert.strictEqual(free.usable, false);
  assert.strictEqual(premium.usable, false);
  assert.strictEqual(ultra.usable, true);
  assert.strictEqual(legacyTop.usable, true);

  let integrated = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  integrated = integrateEmailVerificationServerSource(integrated);
  integrated = integrateBillingServerSource(integrated);
  integrated = integrateFileAnalysisServerSource(integrated);
  integrated = integrateImageUnderstandingServerSource(integrated);
  integrated = integrateVoiceServerSource(integrated);
  integrated = integrateCommandCenterServerSource(integrated);
  integrated = integrateScheduledTasksServerSource(integrated);
  integrated = integrateAgentServerSource(integrated);
  integrated = integrateMemoryServerSource(integrated);
  integrated = integrateModeLibraryServerSource(integrated);
  integrated = integrateAdvertisingAnalyticsServerSource(integrated);
  integrated = integrateAdvertisingPolicyServerSource(integrated);
  integrated = integrateModelRoutingServerSource(integrated);
  integrated = integrateConnectedAppsServerSource(integrated);

  assert.ok(integrated.includes("CREATE TABLE IF NOT EXISTS connected_app_connections"));
  assert.ok(integrated.includes("CREATE TABLE IF NOT EXISTS connected_app_oauth_states"));
  assert.ok(integrated.includes("pkce_verifier_ciphertext"));
  assert.ok(integrated.includes("ALTER COLUMN pkce_verifier_ciphertext SET NOT NULL"));
  assert.ok(integrated.includes('requireCapability("connected_apps")'));
  assert.ok(integrated.includes('"/api/connections"'));
  assert.ok(integrated.includes('"/connected-apps.html"'));
  new vm.Script(integrated, { filename: "integrated-server-connected-apps.js" });

  const page = fs.readFileSync(path.join(appRoot, "connected-apps.html"), "utf8");
  assert.ok(page.includes("Read-only repository and account access"));
  assert.ok(page.includes("Write operations are intentionally disabled"));
  assert.ok(page.includes("/api/connections/github/authorize"));
  assert.ok(page.includes("/api/connections/github/repositories"));
  assert.ok(page.includes("/api/connections/github"));
  assert.ok(!page.includes("GITHUB_APP_CLIENT_SECRET"));
  assert.ok(!page.includes("CONNECTED_APPS_TOKEN_KEY"));
  assert.ok(!page.includes("access_token"));
  assert.ok(!page.includes("refresh_token"));
  assert.ok(!page.includes("code_verifier"));

  const routeSource = fs.readFileSync(path.join(appRoot, "connections", "routes.js"), "utf8");
  assert.ok(routeSource.includes("state_hash"));
  assert.ok(routeSource.includes("pkce_verifier_ciphertext"));
  assert.ok(routeSource.includes('aad: secretAad(req.user.id, "pkce")'));
  assert.ok(routeSource.includes("DELETE FROM connected_app_oauth_states"));
  assert.ok(routeSource.includes('require("./store")'));
  const storeSource = fs.readFileSync(path.join(appRoot, "connections", "store.js"), "utf8");
  assert.ok(storeSource.includes("encryptSecret(accessToken"));
  assert.ok(storeSource.includes("provider = $2"));
  assert.ok(storeSource.includes("SUPPORTED_CONNECTED_APP_PROVIDERS"));
  assert.ok(routeSource.includes("revokeUserToken({ accessToken })"));
  assert.ok(!routeSource.includes("console.log(accessToken"));
  assert.ok(!routeSource.includes("res.json({ accessToken"));

  const startup = fs.readFileSync(path.join(appRoot, "start.js"), "utf8");
  assert.ok(startup.includes('require("./connections/server-integration")'));
  assert.ok(startup.includes("integrateConnectedAppsServerSource(integratedSource)"));
  assert.ok(
    startup.indexOf("integrateConnectedAppsServerSource(integratedSource)") >
      startup.indexOf("integrateModelRoutingServerSource(integratedSource)"),
    "Connected Apps should integrate after model routing."
  );

  console.log("PASS connected-apps contract: encrypted tokens, one-time state, PKCE, current GitHub API version, refresh/revocation, Ultra entitlement with legacy TOP compatibility, read-only UI, and runtime integration.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
