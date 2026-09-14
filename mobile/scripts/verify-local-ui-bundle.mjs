import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(scriptDir, '..');
const wwwDir = resolve(mobileDir, 'www');
const manifestPath = resolve(wwwDir, 'unbound-local-bundle-manifest.json');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const failures = [];
let manifest = null;

try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  failures.push(`bundle manifest missing or invalid: ${error?.message || error}`);
}

if (manifest) {
  if (manifest.schemaVersion !== 1) failures.push('unexpected bundle manifest schema version');
  if (manifest.releaseReady !== false) failures.push('local UI bundle must not claim store release readiness');
  if (!String(manifest.transportStatus || '').includes('not yet attested')) {
    failures.push('manifest must preserve the native API/session transport blocker');
  }

  const requiredScripts = [
    'desktop-voice-input.js',
    'native-mobile-bridge.js',
    'voice-presets.js',
    'continuous-voice.js',
    'health-status.js',
    'runtime-capabilities.js',
    'device-inspector.js',
    'action-bridge.js',
    'tier-controls.js',
    'media-capture.js',
    'voice-media-shortcuts.js',
    'adult-step-up.js'
  ];
  const requiredPages = [
    'terms.html',
    'privacy.html',
    'advertisers.html',
    'connected-apps.html',
    'images.html',
    'files.html'
  ];
  const requiredFiles = ['index.html', ...requiredScripts, ...requiredPages, 'unbound-cosmic.png'];

  for (const file of requiredFiles) {
    const record = manifest.files?.[file];
    if (!record?.sha256 || !Number.isFinite(Number(record?.bytes)) || Number(record.bytes) <= 0) {
      failures.push(`manifest is missing a valid record for ${file}`);
      continue;
    }

    try {
      const bytes = await readFile(resolve(wwwDir, file));
      if (bytes.length !== Number(record.bytes)) failures.push(`${file}: byte count does not match manifest`);
      if (sha256(bytes) !== record.sha256) failures.push(`${file}: SHA-256 does not match manifest`);
    } catch (error) {
      failures.push(`${file}: missing or unreadable (${error?.message || error})`);
    }
  }

  try {
    const homepage = await readFile(resolve(wwwDir, 'index.html'), 'utf8');
    if (!homepage.includes('<meta name="unbound-local-ui-bundle" content="generated" />')) {
      failures.push('generated homepage is missing the local UI bundle marker');
    }
    if (homepage.includes('<meta name="unbound-production-bundle" content="ready"')) {
      failures.push('local UI bundle must not add the production-ready release marker');
    }
    for (const script of requiredScripts) {
      if (!homepage.includes(`src="./${script}?v=`)) failures.push(`generated homepage is missing local runtime script ${script}`);
      if (homepage.includes(`src="/${script}?v=`)) failures.push(`generated homepage still contains server-root runtime script ${script}`);
    }
    for (const expected of [
      'unbound-mobile-layout-v101',
      'unboundVoiceListenButton',
      'let streamCompleted = false;',
      '[Response interrupted before completion.]'
    ]) {
      if (!homepage.includes(expected)) failures.push(`generated homepage is missing transformed production UI marker ${expected}`);
    }
  } catch (error) {
    failures.push(`generated homepage validation failed: ${error?.message || error}`);
  }
}

if (failures.length) {
  console.error('UNBOUND local mobile UI bundle verification failed.');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('UNBOUND local mobile UI bundle is complete, hash-verified, and intentionally not store-release-ready.');
