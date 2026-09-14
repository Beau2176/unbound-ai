import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(scriptDir, '..');
const runtimeDir = resolve(mobileDir, 'runtime');
const PRODUCTION_API_ORIGIN = 'https://unbound-ai-app.onrender.com';
const EXPECTED_APP_ID = 'ai.unbound.app';

const [validationSource, launcherSource, pageSource] = await Promise.all([
  readFile(resolve(runtimeDir, 'native-validation.js'), 'utf8'),
  readFile(resolve(runtimeDir, 'native-validation-link.js'), 'utf8'),
  readFile(resolve(mobileDir, 'native-validation.html'), 'utf8')
]);

assert.doesNotThrow(() => new vm.Script(validationSource), 'native validation runtime must parse as JavaScript');
assert.doesNotThrow(() => new vm.Script(launcherSource), 'native validation launcher must parse as JavaScript');

for (const forbidden of [
  'document.cookie',
  'CapacitorCookies',
  '.json()',
  '.text()',
  '/api/chat',
  "method: 'POST'",
  'password',
  'sessionToken',
  'accessToken',
  'refreshToken'
]) {
  assert(!validationSource.includes(forbidden), `native validation runtime must not contain sensitive or side-effecting pattern: ${forbidden}`);
}

for (const required of [
  '/api/system/status',
  '/api/auth/me',
  '/api/account/access',
  'credentials: \'include\'',
  'background-resume-session',
  'session-across-launches',
  'unbound:native-validation-report',
  "const EXPECTED_APP_ID = 'ai.unbound.app'",
  'appPlugin.getInfo()'
]) {
  assert(validationSource.includes(required), `native validation runtime is missing required check marker: ${required}`);
}

assert(pageSource.includes('src="./native-api-bridge.js?v=108"'), 'validation page must load native API bridge first');
assert(pageSource.includes('src="./native-validation.js?v=110"'), 'validation page must load current package-bound validation runtime');
assert(pageSource.indexOf('native-api-bridge.js') < pageSource.indexOf('native-validation.js'), 'native API bridge must load before validation runtime');
assert(pageSource.includes('id="runValidationButton"'), 'validation page must provide a manual rerun button');
assert(pageSource.includes('id="copyValidationButton"'), 'validation page must provide a safe report copy button');
assert(pageSource.includes('verifies the packaged UNBOUND AI app identity'), 'validation page must explain package identity verification');
assert(!pageSource.includes('type="password"'), 'validation page must never ask for account credentials');

class TestCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function createLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.has(String(key)) ? store.get(String(key)) : null,
    setItem: (key, value) => store.set(String(key), String(value)),
    removeItem: (key) => store.delete(String(key))
  };
}

function createValidationContext({
  signedIn,
  platform = 'android',
  native = true,
  transportMode = 'capacitor-http',
  transportOrigin = PRODUCTION_API_ORIGIN,
  appId = EXPECTED_APP_ID,
  appName = 'UNBOUND AI',
  appVersion = '1.11.0',
  appBuild = '111'
}) {
  const calls = [];
  const events = [];
  const localStorage = createLocalStorage();
  let authCalls = 0;

  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options: { ...options } });
    const value = String(url);
    if (value === '/api/system/status') return { status: 200, ok: true };
    if (value === '/api/auth/me') {
      authCalls += 1;
      return { status: signedIn ? 200 : 401, ok: signedIn };
    }
    if (value === '/api/account/access') return { status: signedIn ? 200 : 401, ok: signedIn };
    throw new Error(`Unexpected validation request: ${value}`);
  };

  const appPlugin = {
    getInfo: async () => ({
      id: appId,
      name: appName,
      version: appVersion,
      build: appBuild
    }),
    addListener: async () => ({ remove: async () => {} })
  };

  const window = {
    Capacitor: {
      isNativePlatform: () => native,
      getPlatform: () => platform,
      Plugins: { App: appPlugin }
    },
    __UNBOUND_NATIVE_API_TRANSPORT__: {
      mode: transportMode,
      apiOrigin: transportOrigin,
      localOrigin: 'https://localhost'
    },
    dispatchEvent: (event) => {
      events.push(event);
      return true;
    },
    addEventListener: () => {},
    setTimeout
  };

  const document = {
    getElementById: () => null,
    createElement: () => ({
      append: () => {},
      appendChild: () => {},
      setAttribute: () => {},
      dataset: {},
      className: '',
      textContent: ''
    })
  };

  const context = vm.createContext({
    window,
    document,
    location: { origin: 'https://localhost' },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage,
    fetch,
    CustomEvent: TestCustomEvent,
    Date,
    JSON,
    Object,
    String,
    Number,
    Boolean,
    Math,
    Promise,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(validationSource, context);
  return { window, calls, events, localStorage, getAuthCalls: () => authCalls };
}

for (const platform of ['android', 'ios']) {
  for (const signedIn of [true, false]) {
    const harness = createValidationContext({ signedIn, platform });
    assert(harness.window.UNBOUND_NATIVE_VALIDATION, 'native validation API must be exported');

    const report = await harness.window.UNBOUND_NATIVE_VALIDATION.run({ reason: 'contract-test' });
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.native, true);
    assert.equal(report.platform, platform);
    assert.equal(report.apiOrigin, PRODUCTION_API_ORIGIN);
    assert.equal(report.signedIn, signedIn);
    assert.deepEqual(
      JSON.parse(JSON.stringify(report.app)),
      { id: EXPECTED_APP_ID, name: 'UNBOUND AI', version: '1.11.0', build: '111' }
    );
    assert(report.checks.some((check) => check.id === 'app-identity' && check.status === 'pass'));
    assert(harness.calls.some((call) => call.url === '/api/system/status'));
    assert(harness.calls.filter((call) => call.url === '/api/auth/me').length >= 2);
    assert(harness.calls.some((call) => call.url === '/api/account/access'));
    assert(harness.calls.every((call) => call.options.credentials === 'include'), 'every validation request must use credentials include');

    const serialized = JSON.stringify(report).toLowerCase();
    for (const forbiddenOutput of ['cookie', 'token', 'email', 'password', 'authorization']) {
      assert(!serialized.includes(forbiddenOutput), `safe validation report must not expose ${forbiddenOutput}`);
    }

    const reportEvent = harness.events.find((event) => event.type === 'unbound:native-validation-report');
    assert(reportEvent, 'validation must emit a local safe report event');
    assert.equal(reportEvent.detail.platform, platform);
    assert.equal(reportEvent.detail.signedIn, signedIn);
    assert.equal(reportEvent.detail.app.id, EXPECTED_APP_ID);
  }
}

{
  const harness = createValidationContext({ signedIn: true, native: false, platform: 'web' });
  const report = await harness.window.UNBOUND_NATIVE_VALIDATION.run({ reason: 'non-native-contract-test' });
  assert.equal(report.native, false);
  assert.equal(report.platform, 'web');
  assert.equal(report.overall, 'fail');
  assert.equal(report.signedIn, null);
  assert.equal(report.app, null);
  assert.equal(harness.calls.length, 0, 'non-native validation must not probe production API routes');
  assert(report.checks.some((check) => check.id === 'native-platform' && check.status === 'fail'));
  assert(report.checks.some((check) => check.id === 'app-identity' && check.status === 'fail'));
}

{
  const harness = createValidationContext({ signedIn: true, appId: 'com.example.copied-shell' });
  const report = await harness.window.UNBOUND_NATIVE_VALIDATION.run({ reason: 'wrong-app-contract-test' });
  assert.equal(report.native, true);
  assert.equal(report.app.id, 'com.example.copied-shell');
  assert.equal(report.overall, 'fail');
  assert.equal(report.signedIn, null);
  assert.equal(harness.calls.length, 0, 'wrong native package identity must fail before probing production API routes');
  assert(report.checks.some((check) => check.id === 'app-identity' && check.status === 'fail'));
}

for (const misconfigured of [
  { transportMode: 'fetch', transportOrigin: PRODUCTION_API_ORIGIN },
  { transportMode: 'capacitor-http', transportOrigin: 'https://example.invalid' }
]) {
  const harness = createValidationContext({ signedIn: true, ...misconfigured });
  const report = await harness.window.UNBOUND_NATIVE_VALIDATION.run({ reason: 'bad-transport-contract-test' });
  assert.equal(report.native, true);
  assert.equal(report.app.id, EXPECTED_APP_ID);
  assert.equal(report.overall, 'fail');
  assert.equal(report.signedIn, null);
  assert.equal(harness.calls.length, 0, 'misconfigured native transport must fail before probing API routes');
  assert(report.checks.some((check) => check.id === 'native-api-transport' && check.status === 'fail'));
}

function executeLauncher({ protocol, hostname, native = true }) {
  const appended = [];
  const target = { appendChild: (node) => appended.push(node) };
  const known = new Map();
  const document = {
    getElementById: (id) => known.get(id) || null,
    querySelector: (selector) => selector === '.topbar-right' ? target : null,
    createElement: () => {
      const node = {
        id: '',
        className: '',
        href: '',
        textContent: '',
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; }
      };
      return node;
    }
  };
  target.appendChild = (node) => {
    appended.push(node);
    if (node.id) known.set(node.id, node);
  };

  const window = {
    Capacitor: { isNativePlatform: () => native },
    addEventListener: () => {}
  };

  vm.runInContext(
    launcherSource,
    vm.createContext({
      window,
      document,
      location: { protocol, hostname },
      String
    })
  );

  return appended;
}

for (const local of [
  { protocol: 'https:', hostname: 'localhost' },
  { protocol: 'capacitor:', hostname: 'localhost' }
]) {
  const links = executeLauncher(local);
  assert.equal(links.length, 1, `${local.protocol}//localhost should expose exactly one local validation link`);
  assert.equal(links[0].href, './native-validation.html');
  assert.equal(links[0].id, 'unboundNativeValidationLink');
}

assert.equal(
  executeLauncher({ protocol: 'https:', hostname: 'unbound-ai-app.onrender.com' }).length,
  0,
  'hosted remote-development UI must not expose the local validation link'
);
assert.equal(
  executeLauncher({ protocol: 'https:', hostname: 'localhost', native: false }).length,
  0,
  'ordinary non-native web environments must not expose the validation link'
);

console.log('UNBOUND native validation Android/iOS package identity, privacy, fail-closed behavior, and local-only launcher checks passed.');
