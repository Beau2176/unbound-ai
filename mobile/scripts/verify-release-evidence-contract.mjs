import assert from 'node:assert/strict';
import {
  EXPECTED_APP_ID,
  PRODUCTION_API_ORIGIN,
  REQUIRED_MANUAL_CHECKS,
  REQUIRED_REPORT_CHECKS,
  validatePlatformEvidence
} from './release-evidence.mjs';

const nowMs = Date.parse('2026-09-14T18:55:00.000Z');
const testedAt = new Date(nowMs).toISOString();
const checkedAt = new Date(nowMs - 5 * 60 * 1000).toISOString();
const bundleManifestSha256 = 'a'.repeat(64);

function validEvidence(platform) {
  return {
    schemaVersion: 1,
    platform,
    signedBuild: true,
    testedAt,
    bundleManifestSha256,
    validationReport: {
      schemaVersion: 2,
      checkedAt,
      platform,
      native: true,
      app: {
        id: EXPECTED_APP_ID,
        name: 'UNBOUND AI',
        version: '1.12.0',
        build: '112'
      },
      localOrigin: 'https://localhost',
      apiOrigin: PRODUCTION_API_ORIGIN,
      overall: 'pass',
      signedIn: true,
      checks: REQUIRED_REPORT_CHECKS.map((id) => ({
        id,
        status: 'pass',
        summary: `${id} passed`
      }))
    },
    manualChecks: Object.fromEntries(REQUIRED_MANUAL_CHECKS.map((id) => [id, true]))
  };
}

for (const platform of ['android', 'ios']) {
  const result = validatePlatformEvidence(validEvidence(platform), {
    platform,
    bundleManifestSha256,
    nowMs
  });
  assert.equal(result.ready, true, `${platform} valid evidence should pass: ${result.errors.join('; ')}`);
  assert.deepEqual(result.errors, []);
}

{
  const evidence = validEvidence('android');
  evidence.validationReport.app.id = 'com.example.copied-shell';
  const result = validatePlatformEvidence(evidence, { platform: 'android', bundleManifestSha256, nowMs });
  assert.equal(result.ready, false);
  assert(result.errors.some((error) => error.includes('app ID must be')));
}

{
  const evidence = validEvidence('ios');
  evidence.bundleManifestSha256 = 'b'.repeat(64);
  const result = validatePlatformEvidence(evidence, { platform: 'ios', bundleManifestSha256, nowMs });
  assert.equal(result.ready, false);
  assert(result.errors.some((error) => error.includes('does not match the current generated mobile bundle')));
}

{
  const evidence = validEvidence('android');
  evidence.manualChecks.passkeyAuthentication = false;
  const result = validatePlatformEvidence(evidence, { platform: 'android', bundleManifestSha256, nowMs });
  assert.equal(result.ready, false);
  assert(result.errors.some((error) => error.includes('passkeyAuthentication')));
}

{
  const evidence = validEvidence('ios');
  evidence.validationReport.checks = evidence.validationReport.checks.map((check) =>
    check.id === 'background-resume-session' ? { ...check, status: 'pending' } : check
  );
  evidence.validationReport.overall = 'warning';
  const result = validatePlatformEvidence(evidence, { platform: 'ios', bundleManifestSha256, nowMs });
  assert.equal(result.ready, false);
  assert(result.errors.some((error) => error.includes('overall=pass')));
  assert(result.errors.some((error) => error.includes('background-resume-session')));
}

{
  const evidence = validEvidence('android');
  evidence.testedAt = new Date(nowMs - 31 * 24 * 60 * 60 * 1000).toISOString();
  evidence.validationReport.checkedAt = evidence.testedAt;
  const result = validatePlatformEvidence(evidence, { platform: 'android', bundleManifestSha256, nowMs });
  assert.equal(result.ready, false);
  assert(result.errors.some((error) => error.includes('older than 30 days')));
}

{
  const evidence = validEvidence('ios');
  evidence.validationReport.email = 'should-never-exist@example.com';
  const result = validatePlatformEvidence(evidence, { platform: 'ios', bundleManifestSha256, nowMs });
  assert.equal(result.ready, false);
  assert(result.errors.some((error) => error.includes('unexpected fields')));
  assert(result.errors.some((error) => error.includes('forbidden sensitive field')));
}

console.log('UNBOUND release-evidence contract tests passed for Android/iOS readiness, freshness, package identity, bundle binding, and privacy.');
