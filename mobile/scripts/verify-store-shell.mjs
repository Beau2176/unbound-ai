import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const expectBlocked = process.argv.includes('--expect-blocked');
const configPath = resolve(process.cwd(), 'capacitor.config.ts');
const webIndexPath = resolve(process.cwd(), 'www/index.html');

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

const readyMarker = '<meta name="unbound-production-bundle" content="ready"';
const productionBundleReady = webIndex.includes(readyMarker);

if (failures.length) {
  console.error('UNBOUND store-shell configuration verification failed.');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

if (expectBlocked) {
  if (productionBundleReady) {
    console.error('Expected store preparation to remain blocked, but the production-bundle readiness marker is present. Update the CI expectation as part of the real bundle migration.');
    process.exit(1);
  }
  console.log('UNBOUND store config is remote-free and store preparation is correctly blocked until the real local production bundle is committed.');
  process.exit(0);
}

if (!productionBundleReady) {
  console.error('UNBOUND store preparation is blocked: mobile/www is still the placeholder shell, not the complete production application bundle.');
  console.error('Do not add the readiness marker until the local bundle can provide the full signed-in app and its required API/network strategy without Capacitor server.url.');
  process.exit(1);
}

console.log('UNBOUND store shell is marked ready for native store preparation.');
