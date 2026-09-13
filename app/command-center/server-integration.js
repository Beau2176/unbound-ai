const INTEGRATION_VERSION = "v0.72";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Command Center integration marker is missing: ${label}.`);
    error.code = "COMMAND_CENTER_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Command Center integration marker is ambiguous: ${label}.`);
    error.code = "COMMAND_CENTER_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateCommandCenterServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "COMMAND_CENTER_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const voiceImport = `const {\n  createVoiceRouter,\n  sendVoicePage\n} = require("./voice/routes");`;
  source = replaceExactlyOnce(
    source,
    voiceImport,
    `${voiceImport}\nconst {\n  createCommandCenterRouter,\n  sendCommandCenterPage\n} = require("./command-center/routes");`,
    "command-center-import"
  );

  const voicePage = `app.get("/voice.html", sendVoicePage);`;
  source = replaceExactlyOnce(
    source,
    voicePage,
    `${voicePage}\napp.get(\n  "/command-center.html",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("command_center"),\n  sendCommandCenterPage\n);`,
    "command-center-page-route"
  );

  const voiceMount = `app.use(\n  "/api/voice",\n  requireDatabase,\n  requireSignedIn,\n  voiceSessionRateLimit,\n  requireCapability("voice"),\n  createVoiceRouter({\n    getPool: () => pool\n  })\n);`;
  source = replaceExactlyOnce(
    source,
    voiceMount,
    `${voiceMount}\n\napp.use(\n  "/api/command-center",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("command_center"),\n  createCommandCenterRouter({\n    getPool: () => pool,\n    buildAccountAccess,\n    getGatewayStatus,\n    getBillingGatewayStatus,\n    getAgeVerificationGatewayStatus,\n    getMaintenanceStatus\n  })\n);`,
    "command-center-api-mount"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateCommandCenterServerSource
};
