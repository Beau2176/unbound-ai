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
  if (manifest.schemaVersion !== 4) failures.push('unexpected bundle manifest schema version');
  if (manifest.releaseReady !== false) failures.push('local UI bundle must not claim store release readiness');
  if (!String(manifest.transportStatus || '').includes('package-bound signed native runtime validation pending')) {
    failures.push('manifest must preserve the package-bound signed-device native transport blocker');
  }
  if (manifest.nativeApiTransport?.mode !== 'capacitor-http') {
    failures.push('manifest must identify CapacitorHttp as the native API transport');
  }
  if (manifest.nativeApiTransport?.apiOrigin !== 'https://unbound-ai-app.onrender.com') {
    failures.push('manifest native API origin must stay pinned to the production HTTPS origin');
  }
  if (manifest.nativeValidation?.page !== 'native-validation.html') {
    failures.push('manifest must identify the packaged native validation page');
  }
  if (manifest.nativeValidation?.runtime !== 'native-validation.js') {
    failures.push('manifest must identify the native validation runtime');
  }
  if (manifest.nativeValidation?.launcher !== 'native-validation-link.js') {
    failures.push('manifest must identify the local-only native validation launcher');
  }
  if (manifest.nativeValidation?.expectedAppId !== 'ai.unbound.app') {
    failures.push('native validation manifest must pin the expected UNBOUND native package ID');
  }
  if (manifest.nativeValidation?.reportSchemaVersion !== 2) {
    failures.push('native validation report schema version must remain explicit');
  }
  if (manifest.nativeValidation?.exposesSecrets !== false) {
    failures.push('native validation manifest must explicitly declare that reports expose no secrets');
  }

  const appRuntimeScripts = [
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
  const mobileRuntimeScripts = [
    'native-api-bridge.js',
    'native-validation-link.js',
    'native-validation.js'
  ];
  const requiredPages = [
    'terms.html',
    'privacy.html',
    'advertisers.html',
    'connected-apps.html',
    'images.html',
    'files.html'
  ];
  const mobilePages = ['native-validation.html'];
  const requiredFiles = [
    'index.html',
    ...mobileRuntimeScripts,
    ...appRuntimeScripts,
    ...requiredPages,
    ...mobilePages,
    'unbound-cosmic.png'
  ];

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
    const bridgeBytes = await readFile(resolve(wwwDir, 'native-api-bridge.js'));
    if (sha256(bridgeBytes) !== manifest.nativeApiTransport?.sha256) {
      failures.push('native API transport hash does not match the generated runtime');
    }
  } catch (error) {
    failures.push(`native API transport validation failed: ${error?.message || error}`);
  }

  try {
    const homepage = await readFile(resolve(wwwDir, 'index.html'), 'utf8');
    if (!homepage.includes('<meta name="unbound-local-ui-bundle" content="generated" />')) {
      failures.push('generated homepage is missing the local UI bundle marker');
    }
    if (!homepage.includes('<meta name="unbound-native-api-transport" content="capacitor-http-v1" />')) {
      failures.push('generated homepage is missing the native API transport marker');
    }
    if (!homepage.includes('src="./native-api-bridge.js?v=108"')) {
      failures.push('generated homepage is missing the synchronous native API transport bridge');
    }
    if (!homepage.includes('src="./native-validation-link.js?v=109"')) {
      failures.push('generated homepage is missing the local native validation launcher');
    }
    if (homepage.includes('src="./native-validation.js?v=110"')) {
      failures.push('generated homepage must not run the validation probe runtime continuously');
    }
    if (homepage.includes('<meta name="unbound-production-bundle" content="ready"')) {
      failures.push('local UI bundle must not add the production-ready release marker');
    }
    for (const script of appRuntimeScripts) {
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

  for (const page of requiredPages) {
    try {
      const html = await readFile(resolve(wwwDir, page), 'utf8');
      if (!html.includes('<meta name="unbound-native-api-transport" content="capacitor-http-v1" />')) {
        failures.push(`${page}: missing native API transport marker`);
      }
      if (!html.includes('src="./native-api-bridge.js?v=108"')) {
        failures.push(`${page}: missing native API transport bridge`);
      }
    } catch (error) {
      failures.push(`${page}: transport injection check failed (${error?.message || error})`);
    }
  }

  try {
    const validationPage = await readFile(resolve(wwwDir, 'native-validation.html'), 'utf8');
    if (!validationPage.includes('src="./native-api-bridge.js?v=108"')) {
      failures.push('native validation page must load native API transport before running checks');
    }
    if (!validationPage.includes('src="./native-validation.js?v=110"')) {
      failures.push('native validation page must load the package-bound validation runtime');
    }
    if (!validationPage.includes('id="runValidationButton"')) {
      failures.push('native validation page must expose an explicit rerun control');
    }
    if (!validationPage.includes('id="validationRaw"')) {
      failures.push('native validation page must expose the safe machine-readable report');
    }
  } catch (error) {
    failures.push(`native validation page verification failed: ${error?.message || error}`);
  }
}

if (failures.length) {
  console.error('UNBOUND local mobile UI bundle verification failed.');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('UNBOUND local mobile UI bundle is hash-verified with native transport and a package-bound, no-secret signed-device validation harness packaged.');
