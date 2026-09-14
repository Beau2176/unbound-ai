import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(scriptDir, '..');
const repoRoot = resolve(mobileDir, '..');
const appDir = resolve(repoRoot, 'app');
const runtimeDir = resolve(mobileDir, 'runtime');
const wwwDir = resolve(mobileDir, 'www');

const { injectMobileLayoutStyles } = require(resolve(appDir, 'ui/mobile-layout.js'));
const { injectVoiceListenControl } = require(resolve(appDir, 'ui/voice-listen.js'));
const { injectInterruptedStreamRecovery } = require(resolve(appDir, 'ui/chat-stream-recovery.js'));

const LOCAL_BUNDLE_MARKER = '<meta name="unbound-local-ui-bundle" content="generated" />';
const NATIVE_API_MARKER = '<meta name="unbound-native-api-transport" content="capacitor-http-v1" />';
const NATIVE_API_SCRIPT = ['native-api-bridge.js', '108'];
const RUNTIME_SCRIPTS = [
  ['desktop-voice-input.js', '121'],
  ['native-mobile-bridge.js', '102'],
  ['voice-presets.js', '109'],
  ['continuous-voice.js', '099'],
  ['health-status.js', '121'],
  ['runtime-capabilities.js', '121'],
  ['device-inspector.js', '120'],
  ['action-bridge.js', '120'],
  ['tier-controls.js', '20260914'],
  ['media-capture.js', '20260914'],
  ['voice-media-shortcuts.js', '20260914'],
  ['adult-step-up.js', '095']
];
const PUBLIC_PAGES = [
  'terms.html',
  'privacy.html',
  'advertisers.html',
  'connected-apps.html',
  'images.html',
  'files.html'
];
const STATIC_ASSETS = ['unbound-cosmic.png'];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function injectNativeApiTransport(html) {
  const source = String(html || '');
  const headMarker = '</head>';
  if (source.indexOf(headMarker) < 0 || source.indexOf(headMarker) !== source.lastIndexOf(headMarker)) {
    throw new Error('UNBOUND native API transport head marker is missing or ambiguous.');
  }
  if (source.includes('src="./native-api-bridge.js')) return source;

  const [file, version] = NATIVE_API_SCRIPT;
  return source.replace(
    headMarker,
    `  ${NATIVE_API_MARKER}\n  <script src="./${file}?v=${version}"></script>\n${headMarker}`
  );
}

function injectLocalRuntime(html) {
  const source = String(html || '');
  const headMarker = '</head>';
  const bodyMarker = '</body>';

  if (source.indexOf(headMarker) < 0 || source.indexOf(headMarker) !== source.lastIndexOf(headMarker)) {
    throw new Error('UNBOUND local bundle head marker is missing or ambiguous.');
  }
  if (source.indexOf(bodyMarker) < 0 || source.indexOf(bodyMarker) !== source.lastIndexOf(bodyMarker)) {
    throw new Error('UNBOUND local bundle body marker is missing or ambiguous.');
  }

  let output = source;
  if (!output.includes(LOCAL_BUNDLE_MARKER)) {
    output = output.replace(headMarker, `  ${LOCAL_BUNDLE_MARKER}\n${headMarker}`);
  }

  const tags = RUNTIME_SCRIPTS
    .map(([file, version]) => `  <script src="./${file}?v=${version}" defer></script>`)
    .join('\n');

  for (const [file] of RUNTIME_SCRIPTS) {
    if (output.includes(`src="./${file}`) || output.includes(`src="/${file}`)) {
      throw new Error(`UNBOUND local bundle runtime script already appears before injection: ${file}`);
    }
  }

  return output.replace(bodyMarker, `${tags}\n${bodyMarker}`);
}

async function buildHomepage() {
  const raw = await readFile(resolve(appDir, 'index.html'), 'utf8');
  const mobile = injectMobileLayoutStyles(raw);
  const voice = injectVoiceListenControl(mobile);
  const recovered = injectInterruptedStreamRecovery(voice);
  const transported = injectNativeApiTransport(recovered);
  return injectLocalRuntime(transported);
}

async function writePublicPage(relativePath) {
  const sourcePath = resolve(appDir, relativePath);
  const destinationPath = resolve(wwwDir, relativePath);
  const raw = await readFile(sourcePath, 'utf8');
  const transported = injectNativeApiTransport(raw);
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, transported, 'utf8');
  return destinationPath;
}

async function copyAppRequired(relativePath) {
  const sourcePath = resolve(appDir, relativePath);
  const destinationPath = resolve(wwwDir, relativePath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
  return destinationPath;
}

async function copyNativeRuntime(relativePath) {
  const sourcePath = resolve(runtimeDir, relativePath);
  const destinationPath = resolve(wwwDir, relativePath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
  return destinationPath;
}

await rm(wwwDir, { recursive: true, force: true });
await mkdir(wwwDir, { recursive: true });

const homepage = await buildHomepage();
await writeFile(resolve(wwwDir, 'index.html'), homepage, 'utf8');

await copyNativeRuntime(NATIVE_API_SCRIPT[0]);
for (const [file] of RUNTIME_SCRIPTS) await copyAppRequired(file);
for (const page of PUBLIC_PAGES) await writePublicPage(page);
for (const asset of STATIC_ASSETS) await copyAppRequired(asset);

const outputFiles = [
  'index.html',
  NATIVE_API_SCRIPT[0],
  ...RUNTIME_SCRIPTS.map(([file]) => file),
  ...PUBLIC_PAGES,
  ...STATIC_ASSETS
];

const manifestFiles = {};
for (const file of outputFiles) {
  const bytes = await readFile(resolve(wwwDir, file));
  manifestFiles[file] = {
    bytes: bytes.length,
    sha256: sha256(bytes)
  };
}

const sourceFiles = [
  'index.html',
  'ui/mobile-layout.js',
  'ui/voice-listen.js',
  'ui/chat-stream-recovery.js',
  ...RUNTIME_SCRIPTS.map(([file]) => file),
  ...PUBLIC_PAGES,
  ...STATIC_ASSETS
];
const sourceHashes = {};
for (const file of sourceFiles) {
  const bytes = await readFile(resolve(appDir, file));
  sourceHashes[file] = sha256(bytes);
}

const nativeApiBytes = await readFile(resolve(runtimeDir, NATIVE_API_SCRIPT[0]));

await writeFile(
  resolve(wwwDir, 'unbound-local-bundle-manifest.json'),
  `${JSON.stringify({
    schemaVersion: 2,
    generatedFrom: 'app production UI sources plus mobile native transport runtime',
    releaseReady: false,
    transportStatus: 'capacitor-http bridge implemented; signed native runtime validation pending',
    nativeApiTransport: {
      mode: 'capacitor-http',
      apiOrigin: 'https://unbound-ai-app.onrender.com',
      runtime: NATIVE_API_SCRIPT[0],
      sha256: sha256(nativeApiBytes)
    },
    runtimeScripts: RUNTIME_SCRIPTS.map(([file]) => file),
    publicPages: PUBLIC_PAGES,
    files: manifestFiles,
    sourceSha256: sourceHashes
  }, null, 2)}\n`,
  'utf8'
);

console.log(`UNBOUND local mobile UI bundle generated with ${outputFiles.length} verified output files.`);
console.log('Native API transport is packaged; store release remains blocked pending signed-device session validation.');
