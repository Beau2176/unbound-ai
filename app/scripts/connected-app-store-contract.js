const assert = require("assert");
const { decryptSecret, encryptSecret } = require("../connections/token-vault");
const {
  REFRESH_SKEW_MS,
  SUPPORTED_CONNECTED_APP_PROVIDERS,
  normalizeProviderId,
  secretAad,
  publicConnection,
  loadConnection,
  listConnections,
  saveTokens,
  tokenNeedsRefresh,
  getUsableAccessToken,
  markConnectionUsed,
  deleteConnection
} = require("../connections/store");

async function main() {
  const originalKey = process.env.CONNECTED_APPS_TOKEN_KEY;
  process.env.CONNECTED_APPS_TOKEN_KEY = Buffer.alloc(32, 11).toString("base64");

  try {
    assert.deepStrictEqual(
      SUPPORTED_CONNECTED_APP_PROVIDERS,
      ["github", "google_workspace", "microsoft_365", "slack"]
    );
    assert.strictEqual(normalizeProviderId("GitHub"), "github");
    assert.strictEqual(normalizeProviderId("google_workspace"), "google_workspace");
    assert.strictEqual(normalizeProviderId("unknown"), null);
    assert.strictEqual(secretAad("github", 123, "access"), "unbound:github:123:access");
    assert.strictEqual(secretAad("slack", 123, "refresh"), "unbound:slack:123:refresh");
    assert.throws(
      () => secretAad("unknown", 123, "access"),
      (error) => error?.code === "CONNECTED_APPS_PROVIDER_INVALID"
    );

    const publicRow = {
      provider: "github",
      provider_account_id: "acct-1",
      provider_account_login: "owner",
      access_token_ciphertext: "must-not-leak",
      refresh_token_ciphertext: "must-not-leak",
      access_token_expires_at: "2026-09-20T00:00:00Z",
      refresh_token_expires_at: null,
      connected_at: "2026-09-18T00:00:00Z",
      updated_at: "2026-09-18T00:00:00Z",
      last_used_at: null
    };
    const publicValue = publicConnection(publicRow);
    assert.strictEqual(publicValue.provider, "github");
    assert.strictEqual(publicValue.accountLogin, "owner");
    assert.strictEqual(JSON.stringify(publicValue).includes("must-not-leak"), false);
    assert.strictEqual(publicValue.writeActionsEnabled, false);

    const loadCalls = [];
    const loadPool = {
      async query(sql, params) {
        loadCalls.push({ sql, params });
        return { rows: [publicRow] };
      }
    };
    const loaded = await loadConnection(loadPool, 55, "slack", { forUpdate: true });
    assert.strictEqual(loaded.provider_account_login, "owner");
    assert.deepStrictEqual(loadCalls[0].params, [55, "slack"]);
    assert.ok(loadCalls[0].sql.includes("provider = $2"));
    assert.ok(loadCalls[0].sql.includes("FOR UPDATE"));

    const listPool = {
      async query(sql, params) {
        assert.ok(sql.includes("ORDER BY provider ASC"));
        assert.deepStrictEqual(params, [55]);
        return {
          rows: [
            { ...publicRow, provider: "github" },
            { ...publicRow, provider: "slack", provider_account_login: "workspace" }
          ]
        };
      }
    };
    const listed = await listConnections(listPool, 55);
    assert.deepStrictEqual(listed.map((item) => item.provider), ["github", "slack"]);
    assert.strictEqual(listed[1].accountLogin, "workspace");

    let savedParams = null;
    const savePool = {
      async query(sql, params) {
        savedParams = params;
        assert.ok(sql.includes("ON CONFLICT (user_id, provider)"));
        return {
          rows: [{
            provider: params[1],
            provider_account_id: params[2],
            provider_account_login: params[3],
            access_token_expires_at: params[6],
            refresh_token_expires_at: params[7],
            connected_at: "2026-09-18T00:00:00Z",
            updated_at: "2026-09-18T00:00:00Z",
            last_used_at: null
          }]
        };
      }
    };
    const saved = await saveTokens(
      savePool,
      77,
      "github",
      { id: "123", login: "owner" },
      {
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        expiresAt: "2026-09-20T00:00:00Z",
        refreshTokenExpiresAt: "2026-10-20T00:00:00Z"
      }
    );
    assert.strictEqual(saved.provider, "github");
    assert.strictEqual(savedParams[0], 77);
    assert.strictEqual(savedParams[1], "github");
    assert.notStrictEqual(savedParams[4], "access-secret");
    assert.notStrictEqual(savedParams[5], "refresh-secret");
    assert.strictEqual(
      decryptSecret(savedParams[4], { aad: secretAad("github", 77, "access") }),
      "access-secret"
    );
    assert.strictEqual(
      decryptSecret(savedParams[5], { aad: secretAad("github", 77, "refresh") }),
      "refresh-secret"
    );

    const now = Date.now();
    assert.strictEqual(
      tokenNeedsRefresh({ access_token_expires_at: new Date(now + REFRESH_SKEW_MS + 60_000).toISOString() }, now),
      false
    );
    assert.strictEqual(
      tokenNeedsRefresh({ access_token_expires_at: new Date(now + REFRESH_SKEW_MS - 1).toISOString() }, now),
      true
    );
    assert.strictEqual(tokenNeedsRefresh({ access_token_expires_at: null }, now), false);

    const currentAccess = encryptSecret("current-access", {
      aad: secretAad("github", 88, "access")
    });
    const txLog = [];
    const txClient = {
      async query(sql, params) {
        txLog.push({ sql, params });
        if (/SELECT provider/.test(sql) && /FOR UPDATE/.test(sql)) {
          return {
            rows: [{
              provider: "github",
              provider_account_id: "123",
              provider_account_login: "owner",
              access_token_ciphertext: currentAccess,
              refresh_token_ciphertext: null,
              access_token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              refresh_token_expires_at: null,
              connected_at: "2026-09-18T00:00:00Z",
              updated_at: "2026-09-18T00:00:00Z",
              last_used_at: null
            }]
          };
        }
        return { rows: [] };
      },
      release() {
        txLog.push({ sql: "RELEASE", params: [] });
      }
    };
    const txPool = {
      async connect() {
        return txClient;
      }
    };
    const usable = await getUsableAccessToken(txPool, 88, "github");
    assert.strictEqual(usable.accessToken, "current-access");
    assert.ok(txLog.some((entry) => entry.sql === "BEGIN"));
    assert.ok(txLog.some((entry) => entry.sql === "COMMIT"));
    assert.ok(txLog.some((entry) => entry.sql === "RELEASE"));

    const mutationCalls = [];
    const mutationPool = {
      async query(sql, params) {
        mutationCalls.push({ sql, params });
        return { rows: [{ provider: params[1] }] };
      }
    };
    assert.strictEqual(await markConnectionUsed(mutationPool, 99, "microsoft_365"), true);
    assert.strictEqual(await deleteConnection(mutationPool, 99, "microsoft_365"), true);
    assert.deepStrictEqual(mutationCalls[0].params, [99, "microsoft_365"]);
    assert.deepStrictEqual(mutationCalls[1].params, [99, "microsoft_365"]);

    console.log("PASS Connected Apps shared store: provider isolation, legacy GitHub AAD compatibility, encrypted tokens, refresh timing, safe public views, and generic mutations.");
  } finally {
    if (originalKey === undefined) delete process.env.CONNECTED_APPS_TOKEN_KEY;
    else process.env.CONNECTED_APPS_TOKEN_KEY = originalKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
