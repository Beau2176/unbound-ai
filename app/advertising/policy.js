const ADVERTISING_POLICY_VERSION = "2026-09-v1";

const AD_REVIEW_CHECKS = Object.freeze([
  Object.freeze({
    key: "destinationVerified",
    label: "Destination reviewed",
    description: "The advertiser URL was opened and reviewed; it uses HTTPS and matches the submitted business/creative."
  }),
  Object.freeze({
    key: "legalAndPolicyCompliant",
    label: "Legal and policy compliant",
    description: "The placement does not promote illegal activity or a prohibited UNBOUND advertising category."
  }),
  Object.freeze({
    key: "malwareFraudDeceptionClear",
    label: "Malware, fraud and deception clear",
    description: "No phishing, malware, forced downloads, browser locking, impersonation, deceptive claims, or traffic manipulation was found."
  }),
  Object.freeze({
    key: "adultSafetyClear",
    label: "Adult-safety review clear",
    description: "No minors, age-ambiguous sexual content, exploitation, trafficking, non-consensual sexual content, sexual violence, or stolen intimate content is involved."
  }),
  Object.freeze({
    key: "rightsAndNetworkFitVerified",
    label: "Rights and network fit verified",
    description: "Creative/destination rights appear valid and any selected payment, banking, or external ad-network restrictions were checked."
  })
]);

const PROHIBITED_CATEGORIES = Object.freeze([
  "Illegal goods, services, activity, or content that violates applicable law.",
  "Malware, ransomware, spyware, phishing, credential theft, browser lockers, forced downloads, or deceptive security/scareware claims.",
  "Sexual content involving minors, age-ambiguous persons, exploitation, trafficking, coercion, non-consensual sexual content, sexual violence, or stolen/revenge intimate content.",
  "Counterfeit, stolen, pirated, or knowingly rights-infringing goods, media, software, or creative material.",
  "Sales or promotion of illegal drugs, controlled substances sold unlawfully, illegal drug paraphernalia, or instructions intended to facilitate illegal trafficking.",
  "Sales or promotion of firearms, ammunition, explosives, or other regulated weapons through UNBOUND advertising placements.",
  "Fraud, impersonation, materially deceptive claims, fake endorsements, fake system/user-interface elements, pyramid schemes, or other scams.",
  "Hate or extremist recruitment, praise or fundraising; targeted harassment; or calls for violence against protected or identifiable groups or people.",
  "Artificial, incentivized, bot-generated, or otherwise fraudulent impressions, clicks, conversions, reviews, or engagement.",
  "Any creative or destination that attempts to execute scripts in UNBOUND's ad surface, bypass review, auto-redirect users, or interfere with UNBOUND or user devices."
]);

const RESTRICTED_CATEGORIES = Object.freeze([
  "Lawful adult sexual content or adult-oriented services: manual review, hard 18+ audience separation where applicable, and provider/network compatibility required.",
  "Dating or relationship services: manual review for age, consent, deception, and provider/network compatibility.",
  "Gambling, contests, sweepstakes, or wagering: jurisdiction, licensing, age, banking, payment, and network approval required before acceptance.",
  "Alcohol, tobacco, nicotine, cannabis/CBD, or other age/regulation-sensitive products: jurisdiction and provider compatibility required.",
  "Financial products, investments, credit, debt services, cryptocurrency, or money services: licensing, claims, jurisdiction, and provider compatibility review required.",
  "Medical, health, supplement, cosmetic-treatment, or therapeutic claims: substantiation and applicable regulatory review required.",
  "Political, issue, religious, or advocacy advertising: explicit UNBOUND approval and any required transparency/disclosure review before publication."
]);

function cleanReviewNotes(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.slice(0, 1000);
}

function normalizeAdvertisingReviewDecision(input = {}) {
  const action = String(input.action || "").trim().toLowerCase();
  if (!new Set(["approve", "reject"]).has(action)) return null;

  const checks = {};
  for (const item of AD_REVIEW_CHECKS) {
    checks[item.key] = input?.checks?.[item.key] === true;
  }
  const allChecksConfirmed = AD_REVIEW_CHECKS.every((item) => checks[item.key] === true);
  const notes = cleanReviewNotes(input.notes);

  if (action === "approve" && !allChecksConfirmed) {
    return {
      valid: false,
      action,
      policyVersion: ADVERTISING_POLICY_VERSION,
      checks,
      notes,
      error: "Complete every advertising policy review check before approval."
    };
  }

  return {
    valid: true,
    action,
    policyVersion: ADVERTISING_POLICY_VERSION,
    checks,
    notes,
    allChecksConfirmed
  };
}

function publicAdvertisingPolicy() {
  return {
    version: ADVERTISING_POLICY_VERSION,
    principles: [
      "Paid advertising stays separate from AI answers.",
      "Payment never guarantees publication; every placement is subject to UNBOUND review.",
      "UNBOUND may reject or remove a placement when law, safety, fraud, rights, provider, banking, payment, or network compatibility requires it.",
      "Advertisers are responsible for truthful claims, lawful products/services, destination security, and rights to submitted material."
    ],
    prohibitedCategories: [...PROHIBITED_CATEGORIES],
    restrictedCategories: [...RESTRICTED_CATEGORIES],
    reviewChecks: AD_REVIEW_CHECKS.map((item) => ({ ...item }))
  };
}

module.exports = {
  ADVERTISING_POLICY_VERSION,
  AD_REVIEW_CHECKS,
  PROHIBITED_CATEGORIES,
  RESTRICTED_CATEGORIES,
  cleanReviewNotes,
  normalizeAdvertisingReviewDecision,
  publicAdvertisingPolicy
};
