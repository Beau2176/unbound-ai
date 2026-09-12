const BACKUP_MODES = Object.freeze(["none", "managed", "external", "hybrid"]);

function normalizeBackupMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return BACKUP_MODES.includes(mode) ? mode : "none";
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoOrNull(date) {
  return date ? date.toISOString() : null;
}

function ageHours(date, nowMs) {
  if (!date) return null;
  return Math.max(0, (nowMs - date.getTime()) / 3_600_000);
}

function ageDays(date, nowMs) {
  const hours = ageHours(date, nowMs);
  return hours === null ? null : hours / 24;
}

function buildRecoveryReadiness({ env = process.env, nowMs = Date.now() } = {}) {
  const mode = normalizeBackupMode(env.DATABASE_BACKUP_MODE);
  const managedRecovery =
    mode === "managed" || mode === "hybrid" || truthy(env.DATABASE_MANAGED_RECOVERY_ENABLED);
  const externalBackup =
    mode === "external" || mode === "hybrid" || truthy(env.DATABASE_EXTERNAL_BACKUP_ENABLED);

  const backupProtected = managedRecovery || externalBackup;
  const backupMaxAgeHours = positiveInteger(env.DATABASE_BACKUP_MAX_AGE_HOURS, 26);
  const restoreTestMaxAgeDays = positiveInteger(env.DATABASE_RESTORE_TEST_MAX_AGE_DAYS, 90);
  const lastBackupVerifiedAt = parseTimestamp(env.DATABASE_BACKUP_LAST_VERIFIED_AT);
  const lastRestoreTestedAt = parseTimestamp(env.DATABASE_RESTORE_LAST_TESTED_AT);

  const backupAgeHours = ageHours(lastBackupVerifiedAt, nowMs);
  const restoreAgeDays = ageDays(lastRestoreTestedAt, nowMs);
  const externalBackupFresh = Boolean(
    lastBackupVerifiedAt && backupAgeHours <= backupMaxAgeHours
  );
  const restoreTestFresh = Boolean(
    lastRestoreTestedAt && restoreAgeDays <= restoreTestMaxAgeDays
  );

  const blockers = [];
  if (!backupProtected) {
    blockers.push("No managed recovery or external database backup is declared.");
  }
  if (externalBackup && !lastBackupVerifiedAt) {
    blockers.push("External backup is declared but no verified backup timestamp is recorded.");
  } else if (externalBackup && !externalBackupFresh) {
    blockers.push(
      `The most recent verified external backup is older than ${backupMaxAgeHours} hours.`
    );
  }
  if (!lastRestoreTestedAt) {
    blockers.push("No database restore drill timestamp is recorded.");
  } else if (!restoreTestFresh) {
    blockers.push(
      `The most recent restore drill is older than ${restoreTestMaxAgeDays} days.`
    );
  }

  const backupReady = backupProtected && (!externalBackup || externalBackupFresh);
  const launchReady = backupReady && restoreTestFresh;

  return {
    status: launchReady ? "ready" : backupProtected ? "attention_required" : "unprotected",
    launchReady,
    mode,
    backup: {
      protected: backupProtected,
      managedRecovery,
      externalBackup,
      maxAgeHours: backupMaxAgeHours,
      lastVerifiedAt: isoOrNull(lastBackupVerifiedAt),
      ageHours: backupAgeHours === null ? null : Number(backupAgeHours.toFixed(2)),
      fresh: externalBackup ? externalBackupFresh : managedRecovery
    },
    restoreDrill: {
      maxAgeDays: restoreTestMaxAgeDays,
      lastTestedAt: isoOrNull(lastRestoreTestedAt),
      ageDays: restoreAgeDays === null ? null : Number(restoreAgeDays.toFixed(2)),
      fresh: restoreTestFresh
    },
    blockers
  };
}

module.exports = {
  BACKUP_MODES,
  normalizeBackupMode,
  buildRecoveryReadiness
};
