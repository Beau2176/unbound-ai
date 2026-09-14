import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const RELEASE_EVIDENCE_SCHEMA_VERSION = 1;
export const NATIVE_VALIDATION_SCHEMA_VERSION = 2;
export const EXPECTED_APP_ID = 'ai.unbound.app';
export const PRODUCTION_API_ORIGIN = 'https://unbound-ai-app.onrender.com';
export const MAX_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_REPORT_TO_EVIDENCE_GAP_MS = 24 * 60 * 60 * 1000;

export const REQUIRED_REPORT_CHECKS = Object.freeze([
  'native-platform',
  'app-identity',
  'native-api-transport',
  'api-reachability',
  'system-status-route',
  'auth-route',
  'session-repeat',
  'account-access-route',
  'session-across-launches',
  'background-resume-session'
]);

export const REQUIRED_MANUAL_CHECKS = Object.freeze([
  'passwordSignIn',
  'sessionPersistence',
  'logoutRevocation',
  'passkeyAuthentication',
  'chatCompletion',
  'accountResumeSync',
  'checkoutProviderReturn',
  'ageVerificationProviderReturn',
  'failureRecovery',
  'customSchemeDeepLink',
  'cameraPermissionPrompt',
  'microphonePermissionPrompt',
  'permissionDenialRecovery'
]);

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'platform',
  'signedBuild',
  'testedAt',
  'bundleManifestSha256',
  'validationReport',
  'manualChecks'
]);
const REPORT_KEYS = new Set([
  'schemaVersion',
  'checkedAt',
  'platform',
  'native',
  'app',
  'localOrigin',
  'apiOrigin',
  'overall',
  'signedIn',
  'checks'
]);
const APP_KEYS = new Set(['id', 'name', 'version', 'build']);
const CHECK_KEYS = new Set(['id', 'status', 'summary', 'httpStatus', 'durationMs']);
const FORBIDDEN_SERIALIZED_TERMS = [
  '"cookie"',
  '"token"',
  '"email"',
  '"password"',
  '"authorization"',
  '"sessiontoken"',
  '"accesstoken"',
  '"refreshtoken"'
];

function unknownKeys(object, allowed) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return [];
  return Object.keys(object).filter((key) => !allowed.has(key));
}

function validIso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function validateSha(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

export function validatePlatformEvidence(
  evidence,
  { platform, bundleManifestSha256, nowMs = Date.now() }
) {
  const errors = [];
  const expectedPlatform = String(platform || '').toLowerCase();

  if (!['android', 'ios'].includes(expectedPlatform)) {
    return { ready: false, errors: ['unsupported evidence platform'] };
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { ready: false, errors: [`${expectedPlatform}: evidence must be a JSON object`] };
  }

  const extraTopLevel = unknownKeys(evidence, TOP_LEVEL_KEYS);
  if (extraTopLevel.length) {
    errors.push(`${expectedPlatform}: unexpected top-level fields: ${extraTopLevel.join(', ')}`);
  }
  if (evidence.schemaVersion !== RELEASE_EVIDENCE_SCHEMA_VERSION) {
    errors.push(`${expectedPlatform}: release evidence schema version must be ${RELEASE_EVIDENCE_SCHEMA_VERSION}`);
  }
  if (evidence.platform !== expectedPlatform) {
    errors.push(`${expectedPlatform}: platform field does not match`);
  }
  if (evidence.signedBuild !== true) {
    errors.push(`${expectedPlatform}: evidence must explicitly attest that a signed build was tested`);
  }
  if (!validateSha(evidence.bundleManifestSha256)) {
    errors.push(`${expectedPlatform}: bundleManifestSha256 must be a SHA-256 hex digest`);
  } else if (evidence.bundleManifestSha256 !== bundleManifestSha256) {
    errors.push(`${expectedPlatform}: evidence does not match the current generated mobile bundle`);
  }

  const testedAtMs = validIso(evidence.testedAt);
  if (testedAtMs === null) {
    errors.push(`${expectedPlatform}: testedAt must be a valid ISO date`);
  } else {
    if (testedAtMs > nowMs + 5 * 60 * 1000) {
      errors.push(`${expectedPlatform}: testedAt is unexpectedly in the future`);
    }
    if (nowMs - testedAtMs > MAX_EVIDENCE_AGE_MS) {
      errors.push(`${expectedPlatform}: evidence is older than 30 days`);
    }
  }

  const report = evidence.validationReport;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    errors.push(`${expectedPlatform}: validationReport must be present`);
  } else {
    const extraReport = unknownKeys(report, REPORT_KEYS);
    if (extraReport.length) {
      errors.push(`${expectedPlatform}: validation report has unexpected fields: ${extraReport.join(', ')}`);
    }
    if (report.schemaVersion !== NATIVE_VALIDATION_SCHEMA_VERSION) {
      errors.push(`${expectedPlatform}: native validation report schema must be ${NATIVE_VALIDATION_SCHEMA_VERSION}`);
    }
    if (report.platform !== expectedPlatform) {
      errors.push(`${expectedPlatform}: validation report platform does not match`);
    }
    if (report.native !== true) {
      errors.push(`${expectedPlatform}: validation report must come from a native runtime`);
    }
    if (report.apiOrigin !== PRODUCTION_API_ORIGIN) {
      errors.push(`${expectedPlatform}: validation report API origin is not production`);
    }
    if (report.overall !== 'pass') {
      errors.push(`${expectedPlatform}: native validation report must have overall=pass`);
    }
    if (report.signedIn !== true) {
      errors.push(`${expectedPlatform}: native validation report must prove an authenticated session`);
    }

    const app = report.app;
    if (!app || typeof app !== 'object' || Array.isArray(app)) {
      errors.push(`${expectedPlatform}: native app identity is missing`);
    } else {
      const extraApp = unknownKeys(app, APP_KEYS);
      if (extraApp.length) {
        errors.push(`${expectedPlatform}: app identity has unexpected fields: ${extraApp.join(', ')}`);
      }
      if (app.id !== EXPECTED_APP_ID) {
        errors.push(`${expectedPlatform}: app ID must be ${EXPECTED_APP_ID}`);
      }
      if (!String(app.version || '').trim()) {
        errors.push(`${expectedPlatform}: app version is missing`);
      }
      if (!String(app.build || '').trim()) {
        errors.push(`${expectedPlatform}: app build is missing`);
      }
    }

    const checkedAtMs = validIso(report.checkedAt);
    if (checkedAtMs === null) {
      errors.push(`${expectedPlatform}: native validation checkedAt is invalid`);
    } else if (testedAtMs !== null) {
      if (checkedAtMs > testedAtMs + 5 * 60 * 1000) {
        errors.push(`${expectedPlatform}: native validation was recorded after the evidence completion time`);
      }
      if (testedAtMs - checkedAtMs > MAX_REPORT_TO_EVIDENCE_GAP_MS) {
        errors.push(`${expectedPlatform}: native validation report is more than 24 hours older than the manual evidence`);
      }
    }

    if (!Array.isArray(report.checks)) {
      errors.push(`${expectedPlatform}: validation report checks must be an array`);
    } else {
      const checkMap = new Map();
      for (const check of report.checks) {
        if (!check || typeof check !== 'object' || Array.isArray(check)) {
          errors.push(`${expectedPlatform}: validation report contains an invalid check`);
          continue;
        }
        const extraCheck = unknownKeys(check, CHECK_KEYS);
        if (extraCheck.length) {
          errors.push(`${expectedPlatform}: validation check has unexpected fields: ${extraCheck.join(', ')}`);
        }
        const id = String(check.id || '');
        if (id) checkMap.set(id, check);
      }
      for (const id of REQUIRED_REPORT_CHECKS) {
        const check = checkMap.get(id);
        if (!check) {
          errors.push(`${expectedPlatform}: required native check is missing: ${id}`);
        } else if (check.status !== 'pass') {
          errors.push(`${expectedPlatform}: required native check did not pass: ${id}`);
        }
      }
    }
  }

  const manualChecks = evidence.manualChecks;
  if (!manualChecks || typeof manualChecks !== 'object' || Array.isArray(manualChecks)) {
    errors.push(`${expectedPlatform}: manualChecks must be present`);
  } else {
    const allowedManual = new Set(REQUIRED_MANUAL_CHECKS);
    const extraManual = unknownKeys(manualChecks, allowedManual);
    if (extraManual.length) {
      errors.push(`${expectedPlatform}: unexpected manual checks: ${extraManual.join(', ')}`);
    }
    for (const check of REQUIRED_MANUAL_CHECKS) {
      if (manualChecks[check] !== true) {
        errors.push(`${expectedPlatform}: required real-device scenario is not attested: ${check}`);
      }
    }
  }

  const serialized = JSON.stringify(evidence).toLowerCase();
  for (const forbidden of FORBIDDEN_SERIALIZED_TERMS) {
    if (serialized.includes(forbidden)) {
      errors.push(`${expectedPlatform}: evidence contains forbidden sensitive field ${forbidden}`);
    }
  }

  return { ready: errors.length === 0, errors };
}

export async function readPlatformEvidence({ mobileDir, platform }) {
  const path = resolve(mobileDir, 'release-evidence', `${platform}.json`);
  try {
    return { evidence: JSON.parse(await readFile(path, 'utf8')), path, error: null };
  } catch (error) {
    return {
      evidence: null,
      path,
      error: `${platform}: release evidence missing or invalid (${error?.message || error})`
    };
  }
}
