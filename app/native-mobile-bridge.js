(() => {
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

  document.documentElement.classList.add('unbound-native-app');

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

  const refreshNativeState = async () => {
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

    window.__UNBOUND_NATIVE_STATE__ = state;
    dispatch('unbound:native-state', state);
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

  const normalizeAppUrl = (value) => {
    try {
      const url = new URL(value);
      const allowedHosts = new Set(['unbound-ai-app.onrender.com']);
      if (url.protocol === 'unbound:') return `${location.origin}${url.pathname}${url.search}${url.hash}`;
      if (allowedHosts.has(url.hostname)) return `${location.origin}${url.pathname}${url.search}${url.hash}`;
    } catch {}
    return null;
  };

  const installAppLinkHandler = async () => {
    if (!plugins.App?.addListener) return;
    await plugins.App.addListener('appUrlOpen', ({ url }) => {
      const destination = normalizeAppUrl(url);
      if (destination) location.assign(destination);
    });
    await plugins.App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) refreshNativeState().catch(() => {});
    });
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
