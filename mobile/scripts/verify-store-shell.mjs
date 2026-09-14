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
if (!configSource.includes('CapacitorHttp:') || !configSource.includes('enabled: true')) {
  failures.push('store/native configuration must keep CapacitorHttp enabled for the packaged API transport');
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
    console.error('Expected store preparation to remain blocked, but the production-bundle readiness marker is present. Update the CI expectation only after signed Android/iOS session and provider-flow validation completes.');
    process.exit(1);
  }
  console.log('UNBOUND store config is remote-free, native API transport is configured, and store preparation remains correctly blocked pending signed-device validation.');
  process.exit(0);
}

if (!productionBundleReady) {
  console.error('UNBOUND store preparation is blocked: the packaged native API/session transport has not yet completed signed-device release validation.');
  console.error('Validate sign-in cookie persistence, logout/revocation, chat completion, passkeys, account resume sync, checkout/age-verification provider returns, and failure recovery on signed Android and iOS builds before adding the readiness marker.');
  process.exit(1);
}

console.log('UNBOUND store shell is marked ready for native store preparation.');
