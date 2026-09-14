import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  readPlatformEvidence,
  validatePlatformEvidence
} from './release-evidence.mjs';

const expectBlocked = process.argv.includes('--expect-blocked');
const mobileDir = process.cwd();
const configPath = resolve(mobileDir, 'capacitor.config.ts');
const webIndexPath = resolve(mobileDir, 'www/index.html');
const bundleManifestPath = resolve(mobileDir, 'www/unbound-local-bundle-manifest.json');

const [configSource, webIndex] = await Promise.all([
  readFile(configPath, 'utf8'),
  readFile(webIndexPath, 'utf8')
]);

const failures = [];

if (!configSource.includes("process.env.UNBOUND_MOBILE_ENV || 'store'")) {
  failures.push('store must be the default mobile environment');
}
if (!configSource.includes("environment === 'remote-dev'")) {
  failures.push('remote server configuration must be gated behind explicit remote-dev mode');
}
if (!configSource.includes("url: 'https://unbound-ai-app.onrender.com'")) {
  failures.push('the known Render development origin is missing from the explicit remote-dev block');
}
if (!configSource.includes("allowNavigation: ['unbound-ai-app.onrender.com']")) {
  failures.push('remote-dev allowNavigation must stay constrained to the known Render host');
}
if (!configSource.includes("? { ...baseConfig, server: remoteDevelopmentServer }\n  : baseConfig")) {
  failures.push('store/default configuration must resolve to baseConfig without a server override');
}
if (/const\s+baseConfig[\s\S]*?server\s*:/m.test(configSource.split('const remoteDevelopmentServer')[0])) {
  failures.push('base/store config must not contain a server override');
}
if (!configSource.includes('CapacitorHttp:') || !configSource.includes('enabled: true')) {
  failures.push('store/native configuration must keep CapacitorHttp enabled for the packaged API transport');
}

const legacyReadyMarker = '<meta name="unbound-production-bundle" content="ready"';
if (webIndex.includes(legacyReadyMarker)) {
  failures.push('legacy production-ready HTML marker is forbidden; release readiness must come from Android/iOS evidence files');
}

let bundleManifestSha256 = '';
try {
  const manifestBytes = await readFile(bundleManifestPath);
  bundleManifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
} catch (error) {
  failures.push(`generated mobile bundle manifest is missing or unreadable (${error?.message || error})`);
}

const evidenceResults = [];
if (bundleManifestSha256) {
  for (const platform of ['android', 'ios']) {
    const loaded = await readPlatformEvidence({ mobileDir, platform });
    if (loaded.error) {
      evidenceResults.push({ platform, ready: false, errors: [loaded.error] });
      continue;
    }
    const result = validatePlatformEvidence(loaded.evidence, {
      platform,
      bundleManifestSha256
    });
    evidenceResults.push({ platform, ...result });
  }
}

if (failures.length) {
  console.error('UNBOUND store-shell configuration verification failed.');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

const releaseEvidenceReady =
  evidenceResults.length === 2 &&
  evidenceResults.every((result) => result.ready);

if (expectBlocked) {
  if (releaseEvidenceReady) {
    console.error('Expected store preparation to remain blocked, but complete Android and iOS signed-device release evidence is present. Update the CI release workflow deliberately before changing this expectation.');
    process.exit(1);
  }
  console.log('UNBOUND store config is remote-free and native transport is configured. Store preparation remains correctly blocked until complete Android and iOS release evidence matches the exact generated bundle.');
  process.exit(0);
}

if (!releaseEvidenceReady) {
  console.error('UNBOUND store preparation is blocked: complete, fresh signed-device release evidence is required for both Android and iOS.');
  for (const result of evidenceResults) {
    for (const error of result.errors || []) console.error(` - ${error}`);
  }
  console.error('Required evidence covers authenticated session persistence, logout/revocation, passkeys, chat completion, account resume, provider returns, failure recovery, custom-scheme routing, and camera/microphone permission behavior.');
  process.exit(1);
}

console.log('UNBOUND store shell passed evidence-backed Android and iOS release validation for the exact generated mobile bundle.');
