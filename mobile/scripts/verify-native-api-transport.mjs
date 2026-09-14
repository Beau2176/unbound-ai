import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(scriptDir, '..');
const bridgePath = resolve(mobileDir, 'runtime/native-api-bridge.js');
const configPath = resolve(mobileDir, 'capacitor.config.ts');
const buildPath = resolve(mobileDir, 'scripts/build-local-ui-bundle.mjs');

const [bridgeSource, configSource, buildSource] = await Promise.all([
  readFile(bridgePath, 'utf8'),
  readFile(configPath, 'utf8'),
  readFile(buildPath, 'utf8')
]);

assert.doesNotThrow(() => new vm.Script(bridgeSource), 'native API bridge must parse as JavaScript');
assert.match(configSource, /CapacitorHttp:\s*\{\s*enabled:\s*true\s*\}/m, 'CapacitorHttp must stay enabled for native transport');
assert(buildSource.includes('src="./native-api-bridge.js?v=${version}"') || buildSource.includes('src="./${file}?v=${version}"'), 'local bundle must inject the native API bridge');
assert(buildSource.includes('PUBLIC_PAGES'), 'local bundle must transport-enable copied public pages');
assert(bridgeSource.includes("credentials: 'include'"), 'native API bridge must promote API requests to credentialed native transport');
assert(bridgeSource.includes("url.pathname.startsWith('/api/')"), 'native API bridge must rewrite only API paths');
assert(bridgeSource.includes("url.origin !== LOCAL_ORIGIN"), 'native API bridge must not rewrite arbitrary external origins');
assert(bridgeSource.includes("https://unbound-ai-app.onrender.com"), 'native API bridge must pin the production HTTPS API origin');

class TestCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

async function exerciseNativeOrigin(origin) {
  const calls = [];
  const events = [];
  const window = {
    Capacitor: {
      isNativePlatform: () => true
    },
    fetch: async (resource, options = {}) => {
      calls.push({ resource, options });
      return { ok: true, status: 200 };
    },
    dispatchEvent: (event) => {
      events.push(event);
      return true;
    }
  };

  const context = vm.createContext({
    window,
    location: { origin },
    URL,
    Request,
    CustomEvent: TestCustomEvent,
    Object
  });
  vm.runInContext(bridgeSource, context);

  assert.equal(window.__UNBOUND_NATIVE_API_TRANSPORT__?.apiOrigin, 'https://unbound-ai-app.onrender.com');
  assert.equal(window.__UNBOUND_NATIVE_API_TRANSPORT__?.localOrigin, origin);
  assert.equal(window.__UNBOUND_NATIVE_API_TRANSPORT__?.mode, 'capacitor-http');
  assert.equal(events.at(-1)?.type, 'unbound:native-api-ready');

  await window.fetch('/api/auth/me', { method: 'GET', credentials: 'same-origin' });
  assert.equal(calls.at(-1)?.resource, 'https://unbound-ai-app.onrender.com/api/auth/me');
  assert.equal(calls.at(-1)?.options?.credentials, 'include');

  await window.fetch('/api/conversations?limit=25', { method: 'GET' });
  assert.equal(calls.at(-1)?.resource, 'https://unbound-ai-app.onrender.com/api/conversations?limit=25');
  assert.equal(calls.at(-1)?.options?.credentials, 'include');

  await window.fetch('/api/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{"message":"transport-check"}'
  });
  assert.equal(calls.at(-1)?.resource, 'https://unbound-ai-app.onrender.com/api/chat');
  assert.equal(calls.at(-1)?.options?.credentials, 'include');
  assert.equal(calls.at(-1)?.options?.body, '{"message":"transport-check"}');

  await window.fetch('/terms.html', { method: 'GET' });
  assert.equal(calls.at(-1)?.resource, '/terms.html', 'non-API local files must stay local');

  await window.fetch('https://example.com/api/test', { method: 'GET' });
  assert.equal(calls.at(-1)?.resource, 'https://example.com/api/test', 'external origins must never be rewritten');
}

await exerciseNativeOrigin('https://localhost');
await exerciseNativeOrigin('capacitor://localhost');

const passthroughCalls = [];
const nonNativeWindow = {
  Capacitor: { isNativePlatform: () => false },
  fetch: async (resource, options = {}) => {
    passthroughCalls.push({ resource, options });
    return { ok: true };
  },
  dispatchEvent: () => true
};
vm.runInContext(
  bridgeSource,
  vm.createContext({
    window: nonNativeWindow,
    location: { origin: 'https://localhost' },
    URL,
    Request,
    CustomEvent: TestCustomEvent,
    Object
  })
);
await nonNativeWindow.fetch('/api/auth/me', { method: 'GET' });
assert.equal(passthroughCalls.at(-1)?.resource, '/api/auth/me', 'non-native environments must remain untouched');
assert.equal(nonNativeWindow.__UNBOUND_NATIVE_API_TRANSPORT__, undefined);

console.log('UNBOUND native API transport checks passed for Android and iOS local origins.');
