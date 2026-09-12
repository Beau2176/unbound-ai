const LEGAL_DOCUMENT_TYPES = Object.freeze(["terms", "privacy"]);

const DEFAULT_LEGAL_VERSIONS = Object.freeze({
  terms: "2026-09-draft",
  privacy: "2026-09-draft"
});

function cleanVersion(value, fallback) {
  const version = String(value || "").trim().slice(0, 80);
  return version || fallback;
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
      required: true
    },
    {
      type: "privacy",
      label: "Privacy Notice",
      version: cleanVersion(env.UNBOUND_PRIVACY_VERSION, DEFAULT_LEGAL_VERSIONS.privacy),
      required: true
    }
  ];
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

  const documents = getLegalDocumentCatalog(env).map((document) => {
    const acceptance = acceptedMap.get(`${document.type}:${document.version}`) || null;
    return {
      ...document,
      accepted: Boolean(acceptance),
      acceptedAt: acceptance?.acceptedAt || null
    };
  });

  return {
    enforcementEnabled: false,
    allCurrentAccepted: documents.every((document) => !document.required || document.accepted),
    documents
  };
}

module.exports = {
  LEGAL_DOCUMENT_TYPES,
  DEFAULT_LEGAL_VERSIONS,
  normalizeLegalDocumentType,
  getLegalDocumentCatalog,
  buildLegalConsentStatus
};
