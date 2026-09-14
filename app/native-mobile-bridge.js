(() => {
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

  document.documentElement.classList.add('unbound-native-app');

  let accountSnapshot = null;
  let nativeReloadPending = false;
  const LOCAL_PROTOCOL = String(location.protocol || '');
  const LOCAL_HOST = String(location.host || '');
  const LOCAL_BASE = LOCAL_PROTOCOL && LOCAL_HOST
    ? `${LOCAL_PROTOCOL}//${LOCAL_HOST}`
    : String(location.origin || '');

  const dispatch = (name, detail) => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  };

  const getJson = async (url) => {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    let body = null;
    try { body = await response.json(); } catch {}
    return { ok: response.ok, status: response.status, body };
  };

  const buildAccountSnapshot = (state) => {
    const auth = state?.auth;
    const access = state?.access;

    if (auth?.status === 401) return JSON.stringify({ signedIn: false });
    if (!auth?.ok || !auth?.body?.user) return null;
    if (!access?.ok || !access?.body?.access) return null;

    const user = auth.body.user;
    const accountAccess = access.body.access;
    const capabilities = Array.isArray(accountAccess.capabilities)
      ? accountAccess.capabilities
          .map((item) => ({
            key: String(item?.key || ''),
            usable: Boolean(item?.usable),
            entitled: Boolean(item?.entitled),
            available: Boolean(item?.available)
          }))
          .filter((item) => item.key)
          .sort((left, right) => left.key.localeCompare(right.key))
      : [];

    return JSON.stringify({
      signedIn: true,
      user: {
        id: String(user.id || ''),
        email: String(user.email || ''),
        displayName: String(user.displayName || ''),
        role: String(user.role || ''),
        planTier: String(user.planTier || ''),
        complimentaryTopTier: Boolean(user.complimentaryTopTier)
      },
      plan: {
        tier: String(accountAccess.plan?.tier || ''),
        source: String(accountAccess.plan?.source || '')
      },
      subscription: {
        status: String(accountAccess.subscription?.status || ''),
        planTier: String(accountAccess.subscription?.planTier || ''),
        cancelAtPeriodEnd: Boolean(accountAccess.subscription?.cancelAtPeriodEnd)
      },
      ageVerification: {
        status: String(accountAccess.ageVerification?.status || ''),
        verified: Boolean(accountAccess.ageVerification?.verified)
      },
      gateways: {
        billingConfigured: Boolean(accountAccess.billingGateway?.configured),
        ageVerificationConfigured: Boolean(accountAccess.ageVerificationGateway?.configured)
      },
      capabilities
    });
  };

  const refreshNativeState = async ({ synchronizeUi = false } = {}) => {
    const [auth, access] = await Promise.allSettled([
      getJson('/api/auth/me'),
      getJson('/api/account/access')
    ]);

    const state = {
      native: true,
      platform: typeof cap.getPlatform === 'function' ? cap.getPlatform() : 'native',
      auth: auth.status === 'fulfilled' ? auth.value : { ok: false, status: 0, body: null },
      access: access.status === 'fulfilled' ? access.value : { ok: false, status: 0, body: null }
    };

    const previousSnapshot = accountSnapshot;
    const nextSnapshot = buildAccountSnapshot(state);
    if (nextSnapshot !== null) accountSnapshot = nextSnapshot;

    window.__UNBOUND_NATIVE_STATE__ = state;
    dispatch('unbound:native-state', state);

    if (
      synchronizeUi &&
      !nativeReloadPending &&
      previousSnapshot !== null &&
      nextSnapshot !== null &&
      previousSnapshot !== nextSnapshot
    ) {
      nativeReloadPending = true;
      dispatch('unbound:native-session-changed', { reason: 'account-state-changed' });
      window.setTimeout(() => location.reload(), 0);
    }

    return state;
  };

  const plugins = cap.Plugins || {};

  const configureChrome = async () => {
    try {
      if (plugins.StatusBar) {
        await plugins.StatusBar.setBackgroundColor({ color: '#000000' });
        await plugins.StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
      }
    } catch {}

    try {
      if (plugins.SplashScreen) await plugins.SplashScreen.hide();
    } catch {}
  };

  const APP_LINK_ROUTES = new Set([
    '/',
    '/index.html',
    '/terms.html',
    '/privacy.html',
    '/advertisers.html',
    '/connected-apps.html'
  ]);

  const CUSTOM_ROUTE_ALIASES = new Map([
    ['home', '/'],
    ['chat', '/'],
    ['terms', '/terms.html'],
    ['privacy', '/privacy.html'],
    ['advertise', '/advertisers.html'],
    ['advertisers', '/advertisers.html'],
    ['apps', '/connected-apps.html']
  ]);

  const normalizePublicRoute = (pathname) => {
    const raw = String(pathname || '/');
    if (!raw.startsWith('/') || raw.includes('\\')) return null;

    try {
      const parsed = new URL(raw, LOCAL_BASE);
      if (parsed.protocol !== LOCAL_PROTOCOL || parsed.host !== LOCAL_HOST) return null;
      if (parsed.username || parsed.password) return null;
      if (parsed.pathname !== raw) return null;
      if (!APP_LINK_ROUTES.has(parsed.pathname)) return null;
      return parsed.pathname;
    } catch {}
    return null;
  };

  const normalizeAppUrl = (value) => {
    const input = typeof value === 'string' ? value.trim() : '';
    if (!input || input.length > 2048) return null;

    try {
      const url = new URL(input);
      if (url.username || url.password || url.port) return null;
      if (url.search.length > 1024 || url.hash.length > 1024) return null;

      let route = null;
      if (url.protocol === 'unbound:') {
        const alias = String(url.hostname || '').toLowerCase();
        if (alias) {
          if (url.pathname && url.pathname !== '/') return null;
          route = CUSTOM_ROUTE_ALIASES.get(alias) || null;
        } else {
          route = normalizePublicRoute(url.pathname || '/');
        }
      } else if (url.protocol === 'https:') {
        const allowedHosts = new Set([
          'unbound-ai-app.onrender.com',
          String(location.hostname || '').toLowerCase()
        ]);
        if (!allowedHosts.has(String(url.hostname || '').toLowerCase())) return null;
        route = normalizePublicRoute(url.pathname);
      } else {
        return null;
      }

      if (!route) return null;
      return `${LOCAL_BASE}${route}${url.search}${url.hash}`;
    } catch {}
    return null;
  };

  const navigateAppUrl = (value) => {
    const destination = normalizeAppUrl(value);
    if (!destination) {
      dispatch('unbound:deep-link-blocked', { reason: 'not-allowed' });
      return false;
    }
    if (destination !== location.href) location.assign(destination);
    return true;
  };

  const installAppLinkHandler = async () => {
    if (!plugins.App?.addListener) return;

    await plugins.App.addListener('appUrlOpen', ({ url }) => {
      navigateAppUrl(url);
    });

    await plugins.App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) refreshNativeState({ synchronizeUi: true }).catch(() => {});
    });

    if (typeof plugins.App.getLaunchUrl === 'function') {
      try {
        const launch = await plugins.App.getLaunchUrl();
        if (launch?.url) navigateAppUrl(launch.url);
      } catch {}
    }
  };

  window.UNBOUND_NATIVE = {
    refreshState: refreshNativeState,
    get state() { return window.__UNBOUND_NATIVE_STATE__ || null; }
  };

  Promise.allSettled([
    configureChrome(),
    installAppLinkHandler(),
    refreshNativeState()
  ]).then(() => dispatch('unbound:native-ready', window.__UNBOUND_NATIVE_STATE__ || { native: true }));
})();
