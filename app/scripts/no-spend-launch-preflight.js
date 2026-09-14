const { buildInfrastructureReadiness } = require("../ops/infrastructure-readiness");
const { buildRecoveryReadiness } = require("../ops/recovery-readiness");
const { buildOwnerReadiness } = require("../ops/owner-readiness");
const { buildEmailDeliveryReadiness } = require("../email/readiness");
const { getBillingGatewayStatus } = require("../billing/gateway");
const { registerBuiltInAgeVerificationProviders } = require("../age/providers/register");
const { getAgeVerificationGatewayStatus } = require("../age/gateway");
const { legalPublishingState } = require("../privacy/legal-consent");
const { publicMalwareScanStatus } = require("../security/malware-scan");

registerBuiltInAgeVerificationProviders();

function findOwnerCheck(owner, key) {
  return owner.checks.find((check) => check.key === key) || {
    key,
    ready: false,
    detail: "Owner/business verification has not been recorded."
  };
}

function bool(value) {
  return value === true;
}

function buildNoSpendLaunchPreflight({ env = process.env, nowMs = Date.now() } = {}) {
  const infrastructure = buildInfrastructureReadiness({ env, nowMs });
  const recovery = buildRecoveryReadiness({ env, nowMs });
  const owner = buildOwnerReadiness({ env, nowMs });
  const billing = getBillingGatewayStatus(env);
  const ageVerification = getAgeVerificationGatewayStatus(env);
  const email = buildEmailDeliveryReadiness({ env, nowMs });
  const legal = legalPublishingState(env);
  const malware = publicMalwareScanStatus(env);

  const bankingApproved = findOwnerCheck(owner, "banking_approved");
  const bankingRails = findOwnerCheck(owner, "banking_rails_verified");
  const segpayMerchant = findOwnerCheck(owner, "segpay_merchant_approved");
  const legalCounsel = findOwnerCheck(owner, "legal_counsel_review");

  const stages = [
    {
      key: "infrastructure",
      label: "Infrastructure",
      ready: bool(infrastructure.launchReady),
      status: infrastructure.status,
      blockers: infrastructure.blockers,
      freeWorkNow: [
        "Keep current infrastructure truthfully marked non-production until the paid migration actually occurs.",
        "Document the target Render service/database plans, health-check path, cutover steps, rollback steps, and verification evidence.",
        "Continue measuring current free-tier CPU, memory, latency, errors, and database connections to size the eventual paid move."
      ],
      finishRequiresSpendOrExternalApproval: true
    },
    {
      key: "backup_restore",
      label: "Backup / restore",
      ready: bool(recovery.launchReady),
      status: recovery.status,
      blockers: recovery.blockers,
      freeWorkNow: [
        "Keep the backup script, checksum contract, and PostgreSQL recovery integration tests green.",
        "Document exact production backup destination, retention, restore command sequence, evidence fields, and incident ownership.",
        "Practice recovery only against synthetic or isolated test databases; never overwrite production during rehearsal."
      ],
      finishRequiresSpendOrExternalApproval: true
    },
    {
      key: "business_bank",
      label: "Business bank",
      ready: bool(bankingApproved.ready && bankingRails.ready),
      status: bankingApproved.ready && bankingRails.ready ? "ready" : "external_action_required",
      blockers: [bankingApproved, bankingRails]
        .filter((check) => !check.ready)
        .map((check) => check.detail),
      freeWorkNow: [
        "Prepare a truthful business-description packet for pre-application eligibility review.",
        "Ask candidate banks whether the exact 18+ AI/SaaS model is acceptable before submitting an account application.",
        "Collect written approval/decline references and compare ACH, wire, hold, reserve, and settlement capabilities only after eligibility is confirmed."
      ],
      finishRequiresSpendOrExternalApproval: true
    },
    {
      key: "segpay",
      label: "Segpay",
      ready: bool(billing.configured && billing.checkout && billing.customerPortal && billing.webhooks && segpayMerchant.ready),
      status: billing.configured ? "configured" : "external_action_required",
      blockers: [
        ...(billing.configured ? [] : ["Segpay production configuration and attestations are not complete."]),
        ...(segpayMerchant.ready ? [] : [segpayMerchant.detail])
      ],
      freeWorkNow: [
        "Prepare the merchant-underwriting packet using the real product description, 18+ controls, prohibited-content policy, refund/cancellation approach, and data-flow summary.",
        "Prepare the exact hosted-pay-page, REF1/REF2 signed-field, authenticated postback, lifecycle, and portal test matrix.",
        "Do not set Segpay approval attestations or production secrets before real Merchant Services confirmation."
      ],
      finishRequiresSpendOrExternalApproval: true
    },
    {
      key: "yoti",
      label: "Yoti",
      ready: bool(ageVerification.configured && ageVerification.startVerification && ageVerification.webhooks && Number(ageVerification.minimumAge) >= 18),
      status: ageVerification.state,
      blockers: ageVerification.configured
        ? []
        : ["Yoti production onboarding, credentials, template, and attestations are not complete."],
      freeWorkNow: [
        "Prepare the Yoti onboarding packet describing the adults-only AI use case, hard 18+ gate, evidence minimization, and supported launch jurisdictions.",
        "Prepare the sandbox/production matrix for over-18, fail, cancel, expiry, duplicate, stale, tampered-signature, and provider-outage cases.",
        "Do not set Yoti verification attestations until the corresponding real provider checks have passed."
      ],
      finishRequiresSpendOrExternalApproval: true
    },
    {
      key: "ses",
      label: "Amazon SES",
      ready: bool(email.launchReady),
      status: email.status,
      blockers: email.blockers,
      freeWorkNow: [
        "Prepare the sender-domain DNS checklist for SPF, DKIM, DMARC, production access, least-privilege credentials, and bounce/complaint handling.",
        "Keep live delivery attestations false until real initial-send, resend, expiry, used-token, invalid-token, and provider-failure tests pass.",
        "No raw verification token, AWS secret, provider message ID, or full verification link may appear in logs or public status."
      ],
      finishRequiresSpendOrExternalApproval: true
    },
    {
      key: "legal",
      label: "Final legal review",
      ready: bool(legal.documentsPublished && legal.acceptanceEnabled && legal.enforcementEnabled && legalCounsel.ready),
      status: legal.documentsPublished ? "published" : "draft_or_unpublished",
      blockers: [
        ...(legal.documentsPublished ? [] : ["Final non-draft Terms and Privacy documents are not published."]),
        ...(legal.acceptanceEnabled ? [] : ["Final policy acceptance is not enabled."]),
        ...(legal.enforcementEnabled ? [] : ["Final policy enforcement is not enabled."]),
        ...(legalCounsel.ready ? [] : [legalCounsel.detail])
      ],
      freeWorkNow: [
        "Resolve operator identity, support/privacy contacts, launch jurisdictions, pricing/refunds, retention, privacy-rights workflow, disputes, IP/output, and provider disclosures in the working drafts.",
        "Keep drafts visibly non-binding and noindex until qualified review is complete.",
        "Prepare a counsel review packet that maps every unresolved clause to the implemented data flow and provider boundary."
      ],
      finishRequiresSpendOrExternalApproval: true
    },
    {
      key: "clamav",
      label: "ClamAV",
      ready: bool(malware.configured && malware.mode === "required" && malware.failClosed),
      status: malware.mode,
      blockers: [
        ...(malware.configured ? [] : ["A private ClamAV scanner is not configured."]),
        ...(malware.mode === "required" ? [] : ["Upload malware scanning is not in required fail-closed mode."])
      ],
      freeWorkNow: [
        "Keep static upload defenses and ClamAV framing/outage contracts green.",
        "Prepare the private-network deployment, EICAR, clean-file, restart, timeout, monitoring, and fail-closed test plan.",
        "Do not expose clamd publicly and do not use live malware for validation."
      ],
      finishRequiresSpendOrExternalApproval: true
    }
  ];

  const prerequisiteKeys = [
    "infrastructure",
    "backup_restore",
    "business_bank",
    "segpay",
    "yoti",
    "ses",
    "legal",
    "clamav"
  ];
  const eligibleToScheduleFinalRehearsal = prerequisiteKeys.every(
    (key) => stages.find((stage) => stage.key === key)?.ready === true
  );

  return {
    profile: "no_spend_launch_preflight",
    checkedAt: new Date(nowMs).toISOString(),
    disclaimer:
      "This command performs configuration/readiness inspection only. It never upgrades hosting, purchases services, sends provider transactions, opens bank accounts, or substitutes for provider/legal approval.",
    stages,
    eligibleToScheduleFinalRehearsal,
    nextFreeStage: stages.find((stage) => !stage.ready)?.key || "final_rehearsal"
  };
}

function formatText(report) {
  const lines = [
    "UNBOUND AI — No-spend launch preflight",
    `Checked: ${report.checkedAt}`,
    ""
  ];
  for (const stage of report.stages) {
    lines.push(`${stage.ready ? "PASS" : "BLOCKED"}  ${stage.label}  (${stage.status})`);
    for (const blocker of stage.blockers || []) lines.push(`  - ${blocker}`);
  }
  lines.push("");
  lines.push(
    report.eligibleToScheduleFinalRehearsal
      ? "All prerequisites report ready; schedule the full launch rehearsal."
      : `Next no-spend focus: ${report.nextFreeStage}`
  );
  lines.push("");
  lines.push(report.disclaimer);
  return lines.join("\n");
}

if (require.main === module) {
  const report = buildNoSpendLaunchPreflight();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatText(report)}\n`);
  }
}

module.exports = {
  buildNoSpendLaunchPreflight,
  formatText
};
