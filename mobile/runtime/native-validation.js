(() => {
  const REPORT_SCHEMA_VERSION = 2;
  const BASELINE_KEY = 'unbound.native.validation.baseline.v1';
  const MAX_BASELINE_AGE_MS = 24 * 60 * 60 * 1000;
  const API_ORIGIN = 'https://unbound-ai-app.onrender.com';
  const EXPECTED_APP_ID = 'ai.unbound.app';

  const state = {
    latestReport: null,
    resumeArmed: false,
    resumeBaselineSignedIn: null,
    resumeResult: null,
    appListenerInstalled: false
  };

  const nowIso = () => new Date().toISOString();

  function result(id, status, summary, extra = {}) {
    return {
      id: String(id || ''),
      status,
      summary: String(summary || '').slice(0, 240),
      ...extra
    };
  }

  function overallFor(checks) {
    if (checks.some((check) => check.status === 'fail')) return 'fail';
    if (checks.some((check) => check.status === 'warn' || check.status === 'pending')) return 'warning';
    return 'pass';
  }

  function platformName() {
    try {
      const cap = window.Capacitor;
      if (cap && typeof cap.getPlatform === 'function') return String(cap.getPlatform() || 'unknown');
    } catch {}
    return 'unknown';
  }

  function isNative() {
    try {
      const cap = window.Capacitor;
      return Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    } catch {
      return false;
    }
  }

  async function readAppInfo() {
    try {
      const appPlugin = window.Capacitor?.Plugins?.App;
      if (!appPlugin || typeof appPlugin.getInfo !== 'function') return null;
      const info = await appPlugin.getInfo();
      return {
        id: String(info?.id || '').slice(0, 160),
        name: String(info?.name || '').slice(0, 120),
        version: String(info?.version || '').slice(0, 80),
        build: String(info?.build || '').slice(0, 80)
      };
    } catch {
      return null;
    }
  }

  async function probe(url, options = {}) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        ...options
      });
      return {
        reached: true,
        status: Number(response.status || 0),
        ok: Boolean(response.ok),
        durationMs: Math.max(0, Date.now() - startedAt)
      };
    } catch (error) {
      return {
        reached: false,
        status: 0,
        ok: false,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: String(error?.message || error || 'request failed').slice(0, 160)
      };
    }
  }

  function readBaseline() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.signedIn !== 'boolean') return null;
      const savedAtMs = Date.parse(String(parsed.savedAt || ''));
      if (!Number.isFinite(savedAtMs)) return null;
      if (Date.now() - savedAtMs > MAX_BASELINE_AGE_MS) return null;
      return {
        signedIn: parsed.signedIn,
        savedAt: new Date(savedAtMs).toISOString()
      };
    } catch {
      return null;
    }
  }

  function writeBaseline(signedIn) {
    try {
      localStorage.setItem(BASELINE_KEY, JSON.stringify({
        signedIn: Boolean(signedIn),
        savedAt: nowIso()
      }));
    } catch {}
  }

  function safeReportCopy(report) {
    return {
      schemaVersion: report.schemaVersion,
      checkedAt: report.checkedAt,
      platform: report.platform,
      native: report.native,
      app: report.app ? { ...report.app } : null,
      localOrigin: report.localOrigin,
      apiOrigin: report.apiOrigin,
      overall: report.overall,
      signedIn: report.signedIn,
      checks: report.checks.map((check) => ({ ...check }))
    };
  }

  function dispatchReport(report) {
    const safe = safeReportCopy(report);
    window.dispatchEvent(new CustomEvent('unbound:native-validation-report', { detail: safe }));
  }

  function renderReport(report) {
    const overallNode = document.getElementById('validationOverall');
    const checkedNode = document.getElementById('validationCheckedAt');
    const platformNode = document.getElementById('validationPlatform');
    const sessionNode = document.getElementById('validationSession');
    const listNode = document.getElementById('validationChecks');
    const rawNode = document.getElementById('validationRaw');

    if (overallNode) {
      overallNode.textContent = String(report.overall || 'unknown').toUpperCase();
      overallNode.dataset.status = report.overall || 'warning';
    }
    if (checkedNode) checkedNode.textContent = report.checkedAt || '—';
    if (platformNode) platformNode.textContent = report.platform || 'unknown';
    if (sessionNode) sessionNode.textContent = report.signedIn === true ? 'Signed in' : report.signedIn === false ? 'Signed out' : 'Unknown';

    if (listNode) {
      listNode.textContent = '';
      for (const check of report.checks) {
        const row = document.createElement('li');
        row.className = 'validation-check';
        row.dataset.status = check.status;

        const badge = document.createElement('span');
        badge.className = 'validation-badge';
        badge.textContent = String(check.status || 'unknown').toUpperCase();

        const copy = document.createElement('div');
        copy.className = 'validation-check-copy';

        const title = document.createElement('strong');
        title.textContent = check.id;

        const summary = document.createElement('span');
        summary.textContent = check.summary;

        copy.append(title, summary);
        row.append(badge, copy);
        listNode.appendChild(row);
      }
    }

    if (rawNode) rawNode.textContent = JSON.stringify(safeReportCopy(report), null, 2);
  }

  async function runValidation({ reason = 'manual' } = {}) {
    const checks = [];
    const native = isNative();
    const platform = platformName();
    const transport = window.__UNBOUND_NATIVE_API_TRANSPORT__ || null;
    const priorBaseline = readBaseline();
    const app = native ? await readAppInfo() : null;

    checks.push(native
      ? result('native-platform', 'pass', `Running inside Capacitor on ${platform}.`)
      : result('native-platform', 'fail', 'This validation must run inside the packaged Android or iOS app.'));

    const appIdentityReady = Boolean(
      app &&
      app.id === EXPECTED_APP_ID &&
      app.version &&
      app.build
    );
    checks.push(appIdentityReady
      ? result('app-identity', 'pass', `Verified native package ${app.id} version ${app.version} build ${app.build}.`)
      : result(
          'app-identity',
          'fail',
          native
            ? `Native package identity is unavailable or does not match ${EXPECTED_APP_ID}.`
            : 'Native package identity cannot be verified outside the packaged app.'
        ));

    const transportReady = Boolean(
      transport &&
      transport.mode === 'capacitor-http' &&
      transport.apiOrigin === API_ORIGIN
    );
    checks.push(transportReady
      ? result('native-api-transport', 'pass', 'Capacitor native API transport bridge is active and pinned to the UNBOUND production API.')
      : result('native-api-transport', 'fail', 'Native API transport bridge is missing or misconfigured.'));

    let system = { reached: false, status: 0, durationMs: 0 };
    let auth1 = { reached: false, status: 0, durationMs: 0 };
    let auth2 = { reached: false, status: 0, durationMs: 0 };
    let access = null;
    let signedIn = null;

    if (native && appIdentityReady && transportReady) {
      [system, auth1] = await Promise.all([
        probe('/api/system/status'),
        probe('/api/auth/me')
      ]);

      checks.push(system.reached
        ? result(
            'api-reachability',
            'pass',
            `Production API responded with HTTP ${system.status}.`,
            { httpStatus: system.status, durationMs: system.durationMs }
          )
        : result('api-reachability', 'fail', 'Production API could not be reached through native transport.', { durationMs: system.durationMs }));

      if (system.reached) {
        checks.push(system.status >= 200 && system.status < 500
          ? result('system-status-route', 'pass', `System status route is reachable (HTTP ${system.status}).`, { httpStatus: system.status })
          : result('system-status-route', 'warn', `System status route reported HTTP ${system.status}.`, { httpStatus: system.status }));
      }

      if (auth1.reached && (auth1.status === 200 || auth1.status === 401)) {
        signedIn = auth1.status === 200;
        checks.push(result(
          'auth-route',
          'pass',
          signedIn ? 'Authenticated session was recognized.' : 'Auth route responded correctly; no signed-in session is active.',
          { httpStatus: auth1.status }
        ));

        auth2 = await probe('/api/auth/me');
        const repeatedSame = auth2.reached && auth2.status === auth1.status;
        checks.push(repeatedSame
          ? result(
              'session-repeat',
              signedIn ? 'pass' : 'pending',
              signedIn
                ? 'A second authenticated request preserved the signed-in session.'
                : 'Repeated auth routing is stable, but sign in before using this check as proof of session persistence.',
              { httpStatus: auth2.status }
            )
          : result('session-repeat', 'fail', 'Repeated auth requests did not preserve a stable session state.', { httpStatus: auth2.status }));

        access = await probe('/api/account/access');
        const expectedAccessStatus = signedIn ? access.status === 200 : access.status === 401;
        checks.push(access.reached && expectedAccessStatus
          ? result(
              'account-access-route',
              signedIn ? 'pass' : 'pending',
              signedIn
                ? 'Authenticated account-access route responded successfully.'
                : 'Signed-out account-access protection responded correctly; sign in to validate authenticated access.',
              { httpStatus: access.status }
            )
          : result(
              'account-access-route',
              'fail',
              `Account-access route returned unexpected HTTP ${access.status || 0}.`,
              { httpStatus: access.status || 0 }
            ));

        if (priorBaseline) {
          if (priorBaseline.signedIn === signedIn) {
            checks.push(result(
              'session-across-launches',
              signedIn ? 'pass' : 'pending',
              signedIn
                ? 'Signed-in state matches the previous native validation run.'
                : 'Signed-out state matches the previous run; sign in to prove authenticated persistence across launches.'
            ));
          } else {
            checks.push(result(
              'session-across-launches',
              'warn',
              'Session state changed since the previous validation run. This may be expected after sign-in, logout, expiry, or revocation.'
            ));
          }
        } else {
          checks.push(result(
            'session-across-launches',
            'pending',
            'Run validation again after closing and reopening the app to check session persistence across launches.'
          ));
        }

        writeBaseline(signedIn);
        state.resumeBaselineSignedIn = signedIn;
      } else {
        checks.push(result(
          'auth-route',
          'fail',
          auth1.reached
            ? `Auth route returned unexpected HTTP ${auth1.status}.`
            : 'Auth route could not be reached through native transport.',
          { httpStatus: auth1.status || 0 }
        ));
      }
    }

    if (state.resumeResult) {
      checks.push({ ...state.resumeResult });
    } else {
      checks.push(result(
        'background-resume-session',
        'pending',
        signedIn
          ? 'Background the app and return once; the validator will automatically verify the signed-in session after resume.'
          : 'Sign in, rerun validation, then background and return to the app to verify authenticated resume behavior.'
      ));
    }

    const report = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      checkedAt: nowIso(),
      reason,
      platform,
      native,
      app,
      localOrigin: String(transport?.localOrigin || location.origin || ''),
      apiOrigin: String(transport?.apiOrigin || ''),
      signedIn,
      checks
    };
    report.overall = overallFor(checks);

    state.latestReport = report;
    renderReport(report);
    dispatchReport(report);
    return safeReportCopy(report);
  }

  async function verifyResumeSession() {
    if (typeof state.resumeBaselineSignedIn !== 'boolean') return;
    const auth = await probe('/api/auth/me');
    const currentSignedIn = auth.status === 200 ? true : auth.status === 401 ? false : null;

    if (currentSignedIn === null) {
      state.resumeResult = result(
        'background-resume-session',
        'fail',
        `Auth state could not be verified after resume (HTTP ${auth.status || 0}).`,
        { httpStatus: auth.status || 0 }
      );
    } else if (currentSignedIn === state.resumeBaselineSignedIn) {
      state.resumeResult = result(
        'background-resume-session',
        state.resumeBaselineSignedIn ? 'pass' : 'pending',
        state.resumeBaselineSignedIn
          ? 'Signed-in session remained valid after the app was backgrounded and resumed.'
          : 'Signed-out state remained stable after resume; sign in to prove authenticated resume persistence.',
        { httpStatus: auth.status }
      );
    } else {
      state.resumeResult = result(
        'background-resume-session',
        'warn',
        'Session state changed while the app was backgrounded. Confirm whether logout, expiry, or revocation was expected.',
        { httpStatus: auth.status }
      );
    }

    await runValidation({ reason: 'app-resume' });
  }

  async function installResumeListener() {
    if (state.appListenerInstalled) return;
    state.appListenerInstalled = true;
    const appPlugin = window.Capacitor?.Plugins?.App;
    if (!appPlugin?.addListener) return;

    try {
      await appPlugin.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          state.resumeArmed = true;
          return;
        }
        if (!state.resumeArmed) return;
        state.resumeArmed = false;
        verifyResumeSession().catch(() => {});
      });
    } catch {}
  }

  async function copyReport() {
    const report = state.latestReport;
    if (!report) return false;
    const text = JSON.stringify(safeReportCopy(report), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function wireUi() {
    const runButton = document.getElementById('runValidationButton');
    const copyButton = document.getElementById('copyValidationButton');
    const copyStatus = document.getElementById('copyValidationStatus');

    if (runButton) {
      runButton.addEventListener('click', async () => {
        runButton.disabled = true;
        try {
          await runValidation({ reason: 'manual' });
        } finally {
          runButton.disabled = false;
        }
      });
    }

    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        const copied = await copyReport();
        if (copyStatus) copyStatus.textContent = copied ? 'Safe report copied.' : 'Copy unavailable on this device.';
      });
    }
  }

  window.UNBOUND_NATIVE_VALIDATION = Object.freeze({
    run: runValidation,
    copyReport,
    get latestReport() {
      return state.latestReport ? safeReportCopy(state.latestReport) : null;
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    wireUi();
    installResumeListener().catch(() => {});
    runValidation({ reason: 'page-load' }).catch(() => {});
  });
})();
