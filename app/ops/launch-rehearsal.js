"use strict";

const { buildNoSpendLaunchPreflight } = require("../scripts/no-spend-launch-preflight");

const REHEARSAL_STATUSES = Object.freeze(["not_run", "pass", "fail", "blocked"]);
const REHEARSAL_ENVIRONMENTS = Object.freeze(["local", "staging", "production"]);

const REHEARSAL_STEPS = Object.freeze([
  {
    key: "public_runtime",
    label: "Public runtime and health",
    description: "Verify homepage, health/readiness endpoints, public assets, and the live customer shell.",
    dependencies: [],
    required: true,
    mayUsePaidProvider: false
  },
  {
    key: "account_auth",
    label: "Account registration and sign-in",
    description: "Verify registration, password sign-in, session handling, sign-out, and duplicate/expired session behavior with a disposable test account.",
    dependencies: [],
    required: true,
    mayUsePaidProvider: false
  },
  {
    key: "passkey_security",
    label: "Passkey and device security",
    description: "Verify passkey registration/sign-in, recovery protections, and device-bound Adult Mode step-up without storing biometric data.",
    dependencies: [],
    required: true,
    mayUsePaidProvider: false
  },
  {
    key: "email_verification",
    label: "Email verification",
    description: "Verify initial delivery, resend, expiry, used-link rejection, invalid token handling, and provider failure behavior.",
    dependencies: ["ses"],
    required: true,
    mayUsePaidProvider: true
  },
  {
    key: "premium_checkout",
    label: "Premium $59.99 checkout",
    description: "Verify a real Premium purchase, webhook lifecycle, entitlement activation, settlement path, and account billing state.",
    dependencies: ["segpay", "business_bank"],
    required: true,
    mayUsePaidProvider: true
  },
  {
    key: "ultra_checkout",
    label: "Ultra $114.99 checkout",
    description: "Verify a real Ultra purchase, webhook lifecycle, entitlement activation, settlement path, and no accidental Premium/Ultra crossover.",
    dependencies: ["segpay", "business_bank"],
    required: true,
    mayUsePaidProvider: true
  },
  {
    key: "hard_age_verification",
    label: "Hard 18+ verification",
    description: "Verify over-18 success, fail/under-threshold outcome, cancellation, expiry, duplicate callback, bad signature, and provider outage behavior.",
    dependencies: ["yoti"],
    required: true,
    mayUsePaidProvider: true
  },
  {
    key: "adult_mode_security",
    label: "Adult Mode access and device step-up",
    description: "Verify Ultra-only access, hard 18+ gate, passkey device confirmation, expiry, manual relock, and denied access when any gate is missing.",
    dependencies: ["yoti"],
    required: true,
    mayUsePaidProvider: false
  },
  {
    key: "media_workflows",
    label: "Camera, photos, video, and files",
    description: "Verify Camera, Photos, Video, and Files controls on desktop/mobile, tier gates, upload defenses, and truthful video limitations.",
    dependencies: [],
    required: true,
    mayUsePaidProvider: true
  },
  {
    key: "billing_management",
    label: "Billing management and cancellation",
    description: "Verify customer portal, cancellation, reactivation where supported, refund/chargeback state handling, and entitlement timing.",
    dependencies: ["segpay"],
    required: true,
    mayUsePaidProvider: true
  },
  {
    key: "account_deletion",
    label: "Account deletion and privacy cleanup",
    description: "Using a disposable account only, verify deletion protections, billing safety, session revocation, and personal-data cleanup behavior.",
    dependencies: [],
    required: true,
    mayUsePaidProvider: false,
    destructive: true
  },
  {
    key: "malware_upload",
    label: "Private malware scanning",
    description: "Verify clean upload, harmless EICAR detection, scanner timeout/outage, restart behavior, and fail-closed required mode.",
    dependencies: ["clamav"],
    required: true,
    mayUsePaidProvider: false
  },
  {
    key: "backup_restore",
    label: "Production backup and isolated restore",
    description: "Verify a real production backup can be integrity-checked and restored into an isolated database without touching production data.",
    dependencies: ["backup_restore"],
    required: true,
    mayUsePaidProvider: false,
    destructive: true
  },
  {
    key: "legal_acceptance",
    label: "Final Terms and Privacy acceptance",
    description: "Verify final published document versions, mandatory acceptance, version recording, and enforcement after qualified review.",
    dependencies: ["legal"],
    required: true,
    mayUsePaidProvider: false
  },
  {
    key: "production_infrastructure",
    label: "Production infrastructure and final smoke",
    description: "Verify durable production compute/database, configured health check, restart behavior, final public smoke test, and rollback readiness.",
    dependencies: ["infrastructure", "backup_restore"],
    required: true,
    mayUsePaidProvider: false
  }
]);

function normalizeRehearsalStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return REHEARSAL_STATUSES.includes(normalized) ? normalized : null;
}

function normalizeRehearsalEnvironment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return REHEARSAL_ENVIRONMENTS.includes(normalized) ? normalized : "staging";
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function cleanRunLabel(value) {
  return cleanText(value, 120) || `Launch rehearsal ${new Date().toISOString().slice(0, 10)}`;
}

function cleanEvidenceNote(value) {
  return cleanText(value, 4000);
}

function stageMap(preflight) {
  return new Map((preflight?.stages || []).map((stage) => [stage.key, stage]));
}

function buildRehearsalCatalogState({ env = process.env, nowMs = Date.now() } = {}) {
  const preflight = buildNoSpendLaunchPreflight({ env, nowMs });
  const stages = stageMap(preflight);
  const dependencies = {};
  for (const stage of preflight.stages || []) {
    dependencies[stage.key] = {
      key: stage.key,
      label: stage.label,
      ready: stage.ready === true,
      status: stage.status,
      blockers: Array.isArray(stage.blockers) ? stage.blockers.slice(0, 10) : []
    };
  }
  const steps = REHEARSAL_STEPS.map((step) => {
    const blockedBy = step.dependencies
      .map((key) => stages.get(key))
      .filter((stage) => !stage || stage.ready !== true)
      .map((stage, index) => ({
        key: step.dependencies[index],
        label: stage?.label || step.dependencies[index],
        status: stage?.status || "not_verified"
      }));
    return {
      ...step,
      dependencyReady: blockedBy.length === 0,
      blockedBy
    };
  });
  return {
    checkedAt: preflight.checkedAt,
    dependencies,
    steps,
    externalPrerequisitesReady: preflight.eligibleToScheduleFinalRehearsal === true,
    disclaimer:
      "This workspace records launch-rehearsal evidence only. A completed rehearsal does not override provider, banking, legal, infrastructure, recovery, or security readiness gates."
  };
}

function findStep(key, catalog = REHEARSAL_STEPS) {
  return catalog.find((step) => step.key === String(key || "").trim()) || null;
}

function canRecordStepStatus(stepState, status) {
  const normalizedStatus = normalizeRehearsalStatus(status);
  if (!stepState || !normalizedStatus) {
    return { allowed: false, reason: "Invalid rehearsal step or status." };
  }
  if (normalizedStatus === "pass" && stepState.dependencyReady !== true) {
    return {
      allowed: false,
      reason: `This step cannot be marked PASS while dependencies are blocked: ${
        (stepState.blockedBy || []).map((item) => item.label || item.key).join(", ") || "unknown dependency"
      }.`
    };
  }
  return { allowed: true, reason: null };
}

function requireEvidenceForStatus(status, evidenceNote) {
  const normalizedStatus = normalizeRehearsalStatus(status);
  if (!["pass", "fail"].includes(normalizedStatus)) return true;
  return cleanEvidenceNote(evidenceNote).length >= 8;
}

function buildRehearsalRunSummary({ catalogState, results = [] } = {}) {
  const resultMap = new Map((results || []).map((item) => [item.step_key || item.stepKey, item]));
  const steps = (catalogState?.steps || []).map((step) => {
    const stored = resultMap.get(step.key) || null;
    const storedStatus = normalizeRehearsalStatus(stored?.status) || "not_run";
    const effectiveStatus =
      storedStatus === "not_run" && step.dependencyReady !== true ? "blocked" : storedStatus;
    return {
      ...step,
      status: effectiveStatus,
      storedStatus,
      evidenceNote: stored?.evidence_note ?? stored?.evidenceNote ?? "",
      testedAt: stored?.tested_at ?? stored?.testedAt ?? null,
      testedBy: stored?.tested_by ?? stored?.testedBy ?? null,
      dependencySnapshot: stored?.dependency_snapshot ?? stored?.dependencySnapshot ?? null
    };
  });
  const counts = {
    pass: steps.filter((item) => item.status === "pass").length,
    fail: steps.filter((item) => item.status === "fail").length,
    blocked: steps.filter((item) => item.status === "blocked").length,
    notRun: steps.filter((item) => item.status === "not_run").length
  };
  const required = steps.filter((item) => item.required !== false);
  const eligibleToFinalize = required.length > 0 && required.every((item) => item.status === "pass");
  return {
    steps,
    counts,
    requiredCount: required.length,
    completionPercent: required.length ? Math.round((counts.pass / required.length) * 100) : 0,
    eligibleToFinalize,
    externalPrerequisitesReady: catalogState?.externalPrerequisitesReady === true
  };
}

module.exports = {
  REHEARSAL_STATUSES,
  REHEARSAL_ENVIRONMENTS,
  REHEARSAL_STEPS,
  normalizeRehearsalStatus,
  normalizeRehearsalEnvironment,
  cleanRunLabel,
  cleanEvidenceNote,
  buildRehearsalCatalogState,
  findStep,
  canRecordStepStatus,
  requireEvidenceForStatus,
  buildRehearsalRunSummary
};
