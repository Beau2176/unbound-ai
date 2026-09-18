const assert = require("assert");
const fs = require("fs");
const path = require("path");
const google = require("../ai/providers/google");
const { providerCatalog } = require("../platform/registry");

const appRoot = path.join(__dirname, "..");

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing start marker: ${startMarker}`);
  assert.ok(end > start, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function main() {
  const originalApproval = process.env.UNBOUND_GOOGLE_SEARCH_GROUNDING_APPROVED;
  try {
    delete process.env.UNBOUND_GOOGLE_SEARCH_GROUNDING_APPROVED;
    assert.strictEqual(google.googleGroundingApproved(), false);
    assert.strictEqual(google.supportsResearch(), false);

    process.env.UNBOUND_GOOGLE_SEARCH_GROUNDING_APPROVED = "true";
    assert.strictEqual(google.googleGroundingApproved(), true);
    assert.strictEqual(google.supportsResearch(), true);
  } finally {
    if (originalApproval === undefined) {
      delete process.env.UNBOUND_GOOGLE_SEARCH_GROUNDING_APPROVED;
    } else {
      process.env.UNBOUND_GOOGLE_SEARCH_GROUNDING_APPROVED = originalApproval;
    }
  }

  const gatedCatalog = providerCatalog({ GEMINI_API_KEY: "configured" });
  const gatedGoogle = gatedCatalog.find((item) => item.id === "google");
  assert(gatedGoogle);
  assert.strictEqual(gatedGoogle.researchImplemented, true);
  assert.strictEqual(gatedGoogle.research, false);
  assert.strictEqual(gatedGoogle.researchLaunchGated, true);
  assert.strictEqual(
    gatedGoogle.researchLaunchGate,
    "UNBOUND_GOOGLE_SEARCH_GROUNDING_APPROVED"
  );

  const approvedCatalog = providerCatalog({
    GEMINI_API_KEY: "configured",
    UNBOUND_GOOGLE_SEARCH_GROUNDING_APPROVED: "true"
  });
  const approvedGoogle = approvedCatalog.find((item) => item.id === "google");
  assert.strictEqual(approvedGoogle.research, true);
  assert.strictEqual(approvedGoogle.researchLaunchGated, false);
  assert.strictEqual(
    approvedGoogle.researchHistoryStorage,
    "text-only-no-links-or-suggestions"
  );
  assert.strictEqual(approvedGoogle.googleGroundingRetentionDays, 30);

  const serverSource = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  assert.ok(
    serverSource.includes("researchStoragePolicy?.persistSources === false")
  );
  assert.ok(
    serverSource.includes("researchStoragePolicy?.persistCitations === false")
  );
  assert.ok(
    serverSource.includes("searchSuggestionsHtml: researchMetadata.searchSuggestionsHtml || null")
  );
  assert.ok(
    serverSource.includes("groundingProvider: researchMetadata.groundingProvider || null")
  );
  assert.ok(
    serverSource.includes("providerRetentionDays:")
  );
  assert.ok(
    serverSource.includes("researchStorage: researchStoragePolicy")
  );

  const persistFunction = between(
    serverSource,
    "async function persistAssistantMessage(",
    'app.get(\n  "/api/conversations",'
  );
  assert.strictEqual(
    persistFunction.includes("searchSuggestionsHtml"),
    false,
    "Search Suggestions must never be written by conversation persistence."
  );

  const indexSource = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
  assert.ok(indexSource.includes("function isSafeGoogleSearchSuggestionsHtml"));
  assert.ok(indexSource.includes("function appendGoogleSearchSuggestions"));
  assert.ok(indexSource.includes('groundingProvider === "google_search"'));
  assert.ok(indexSource.includes("data.researchStorage?.persistSources === false"));
  assert.ok(indexSource.includes("data.researchStorage?.persistCitations === false"));
  assert.ok(indexSource.includes("streamedResearchStorage?.persistSources === false"));
  assert.ok(indexSource.includes("streamedResearchStorage?.persistCitations === false"));
  assert.ok(
    indexSource.includes(
      "Google-grounded research could not be displayed with the required Search Suggestions."
    )
  );
  assert.ok(
    indexSource.includes(
      "Google retains grounded search data for"
    )
  );

  const normalizeHistory = between(
    indexSource,
    "function normalizeHistory(items)",
    "function loadConversation()"
  );
  assert.strictEqual(
    normalizeHistory.includes("searchSuggestionsHtml"),
    false,
    "Guest/local chat history must never store Google Search Suggestions."
  );
  assert.strictEqual(
    normalizeHistory.includes("groundingProvider"),
    false,
    "Guest/local chat history should remain text/sources/citations only."
  );

  const runtimeSource = fs.readFileSync(
    path.join(appRoot, "runtime-capabilities.js"),
    "utf8"
  );
  assert.ok(
    runtimeSource.includes(
      "searchSuggestionsHtml: data?.searchSuggestionsHtml || null"
    )
  );
  assert.ok(
    runtimeSource.includes("groundingProvider: data?.groundingProvider || null")
  );
  assert.ok(
    runtimeSource.includes("researchStorage: data?.researchStorage || null")
  );

  const readme = fs.readFileSync(path.join(appRoot, "..", "README.md"), "utf8");
  assert.ok(readme.includes("UNBOUND_GOOGLE_SEARCH_GROUNDING_APPROVED=true"));
  assert.ok(readme.includes("launch-gated off by default"));
  assert.ok(readme.includes("Only the displayed answer text is persisted"));
  assert.ok(readme.includes("retained by Google for 30 days"));

  console.log(
    "PASS Gemini grounding compliance: approval gate, required Search Suggestions path, ephemeral Links/suggestions, text-only history, retention disclosure, and auto-research metadata preservation."
  );
}

main();
