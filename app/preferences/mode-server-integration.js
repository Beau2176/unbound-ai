const INTEGRATION_VERSION = "v0.78";

function replaceExactlyOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1) {
    const error = new Error(`Mode Library integration marker is missing: ${label}.`);
    error.code = "MODE_LIBRARY_SERVER_INTEGRATION_MARKER_MISSING";
    throw error;
  }
  if (first !== last) {
    const error = new Error(`Mode Library integration marker is ambiguous: ${label}.`);
    error.code = "MODE_LIBRARY_SERVER_INTEGRATION_MARKER_AMBIGUOUS";
    throw error;
  }
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}

function integrateModeLibraryServerSource(serverSource) {
  let source = String(serverSource || "");
  if (!source.trim()) {
    const error = new Error("UNBOUND AI server source is empty.");
    error.code = "MODE_LIBRARY_SERVER_INTEGRATION_SOURCE_EMPTY";
    throw error;
  }

  const memoryImports = `const { createMemoryRouter, sendMemoryPage } = require("./memory/routes");\nconst { buildMemoryPrompt } = require("./memory/context");`;
  source = replaceExactlyOnce(
    source,
    memoryImports,
    `${memoryImports}\nconst { sendModeLibraryPage } = require("./preferences/mode-routes");`,
    "mode-library-import"
  );

  const memoryPage = `app.get(\n  "/memory.html",\n  requireDatabase,\n  requireSignedIn,\n  requireCapability("memory"),\n  sendMemoryPage\n);`;
  source = replaceExactlyOnce(
    source,
    memoryPage,
    `${memoryPage}\napp.get(\n  "/modes.html",\n  requireDatabase,\n  requireSignedIn,\n  sendModeLibraryPage\n);`,
    "mode-library-page-route"
  );

  return source;
}

module.exports = {
  INTEGRATION_VERSION,
  replaceExactlyOnce,
  integrateModeLibraryServerSource
};
