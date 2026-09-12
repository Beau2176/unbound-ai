const LEGAL_DOCUMENT_TYPES = Object.freeze(["terms", "privacy"]);

const DEFAULT_LEGAL_VERSIONS = Object.freeze({
  terms: "2026-09-draft",
  privacy: "2026-09-draft"
});

function cleanVersion(value, fallback) {
  const version = String(value || "").trim().slice(0, 80);
  return version || fallback;
}

function enabledFlag(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function cleanPolicyUrl(value) {
  const url = String(value || "").trim().slice(0, 500);
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeLegalDocumentType(value) {
  const type = String(value || "").trim().toLowerCase();
  return LEGAL_DOCUMENT_TYPES.includes(type) ? type : null;
}

function getLegalDocumentCatalog(env = process.env) {
  return [
    {
      type: "terms",
      label: "Terms of Use",
      version: cleanVersion(env.UNBOUND_TERMS_VERSION, DEFAULT_LEGAL_VERSIONS.terms),
      url: cleanPolicyUrl(env.UNBOUND_TERMS_URL),
      required: true
    },
    {
      type: "privacy",
      label: "Privacy Notice",
      version: cleanVersion(env.UNBOUND_PRIVACY_VERSION, DEFAULT_LEGAL_VERSIONS.privacy),
      url: cleanPolicyUrl(env.UNBOUND_PRIVACY_URL),
      required: true
    }
  ];
}

function legalPublishingState(env = process.env) {
  const documents = getLegalDocumentCatalog(env);
  const documentsPublished = documents.every(
    (document) => document.url && !document.version.toLowerCase().includes("draft")
  );
  const acceptanceEnabled =
    enabledFlag(env.UNBOUND_LEGAL_ACCEPTANCE_ENABLED) && documentsPublished;
  const enforcementEnabled =
    acceptanceEnabled && enabledFlag(env.UNBOUND_LEGAL_ENFORCEMENT_ENABLED);

  return {
    documents,
    documentsPublished,
    acceptanceEnabled,
    enforcementEnabled
  };
}

function buildLegalConsentStatus({ acceptedRows = [], env = process.env } = {}) {
  const acceptedMap = new Map();

  for (const row of Array.isArray(acceptedRows) ? acceptedRows : []) {
    const type = normalizeLegalDocumentType(row?.document_type || row?.type);
    const version = cleanVersion(row?.document_version || row?.version, "");
    if (!type || !version) continue;

    acceptedMap.set(`${type}:${version}`, {
      acceptedAt: row?.accepted_at || row?.acceptedAt || null
    });
  }

  const publishing = legalPublishingState(env);
  const documents = publishing.documents.map((document) => {
    const acceptance = acceptedMap.get(`${document.type}:${document.version}`) || null;
    return {
      ...document,
      accepted: Boolean(acceptance),
      acceptedAt: acceptance?.acceptedAt || null
    };
  });

  return {
    documentsPublished: publishing.documentsPublished,
    acceptanceEnabled: publishing.acceptanceEnabled,
    enforcementEnabled: publishing.enforcementEnabled,
    allCurrentAccepted: documents.every((document) => !document.required || document.accepted),
    documents
  };
}

module.exports = {
  LEGAL_DOCUMENT_TYPES,
  DEFAULT_LEGAL_VERSIONS,
  normalizeLegalDocumentType,
  getLegalDocumentCatalog,
  legalPublishingState,
  buildLegalConsentStatus
};
