const INTEGRATION_VERSION = "v0.87";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Connected Apps integration marker is missing: ${label}.`);
    error.code = "CONNECTED_APPS_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Connected Apps integration marker is ambiguous: ${label}.`);
    error.code = "CONNECTED_APPS_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateConnectedAppsServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "CONNECTED_APPS_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const modelImport = `const { resolveChatModel } = require("./ai/model-routing");`;
  source = replaceExactlyOnce(
    source,
    modelImport,
    `${modelImport}\nconst { createConnectionsRouter, sendConnectedAppsPage } = require("./connections/routes");`,
    "connected-apps-import"
  );

  const memoryIndex = `CREATE INDEX IF NOT EXISTS user_memories_user_idx\n      ON user_memories(user_id, enabled, updated_at DESC, id DESC);`;
  source = replaceExactlyOnce(
    source,
    memoryIndex,
    `${memoryIndex}\n\n    CREATE TABLE IF NOT EXISTS connected_app_connections (\n      id BIGSERIAL PRIMARY KEY,\n      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n      provider TEXT NOT NULL,\n      provider_account_id TEXT NOT NULL,\n      provider_account_login TEXT NOT NULL,\n      access_token_ciphertext TEXT NOT NULL,\n      refresh_token_ciphertext TEXT,\n      access_token_expires_at TIMESTAMPTZ,\n      refresh_token_expires_at TIMESTAMPTZ,\n      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      last_used_at TIMESTAMPTZ,\n      CONSTRAINT connected_app_connections_provider_check CHECK (char_length(provider) BETWEEN 1 AND 80),\n      CONSTRAINT connected_app_connections_account_id_check CHECK (char_length(provider_account_id) BETWEEN 1 AND 300),\n      CONSTRAINT connected_app_connections_account_login_check CHECK (char_length(provider_account_login) BETWEEN 1 AND 300),\n      CONSTRAINT connected_app_connections_user_provider_unique UNIQUE (user_id, provider)\n    );\n\n    CREATE INDEX IF NOT EXISTS connected_app_connections_user_idx\n      ON connected_app_connections(user_id, provider, updated_at DESC);\n\n    CREATE TABLE IF NOT EXISTS connected_app_oauth_states (\n      id BIGSERIAL PRIMARY KEY,\n      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n      provider TEXT NOT NULL,\n      state_hash CHAR(64) NOT NULL,\n      pkce_verifier_ciphertext TEXT,\n      expires_at TIMESTAMPTZ NOT NULL,\n      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      CONSTRAINT connected_app_oauth_states_provider_check CHECK (char_length(provider) BETWEEN 1 AND 80),\n      CONSTRAINT connected_app_oauth_states_hash_check CHECK (state_hash ~ '^[0-9a-f]{64}$'),\n      CONSTRAINT connected_app_oauth_states_user_provider_unique UNIQUE (user_id, provider)\n    );\n\n    ALTER TABLE connected_app_oauth_states\n      ADD COLUMN IF NOT EXISTS pkce_verifier_ciphertext TEXT;\n\n    DELETE FROM connected_app_oauth_states\n      WHERE pkce_verifier_ciphertext IS NULL;\n\n    ALTER TABLE connected_app_oauth_states\n      ALTER COLUMN pkce_verifier_ciphertext SET NOT NULL;\n\n    CREATE INDEX IF NOT EXISTS connected_app_oauth_states_expiry_idx\n      ON connected_app_oauth_states(expires_at);`,
    "connected-apps-schema"
  );

  const healthRoute = `app.get("/api/health", (req, res) => {`;
  source = replaceExactlyOnce(
    source,
    healthRoute,
    `app.get(\n  "/connected-apps.html",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("connected_apps"),\n  sendConnectedAppsPage\n);\n\napp.use(\n  "/api/connections",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("connected_apps"),\n  createConnectionsRouter({\n    getPool: () => pool\n  })\n);\n\n${healthRoute}`,
    "connected-apps-routes"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateConnectedAppsServerSource
};
