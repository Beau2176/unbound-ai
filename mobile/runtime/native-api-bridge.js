(() => {
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

  const API_ORIGIN = 'https://unbound-ai-app.onrender.com';
  const LOCAL_ORIGIN = String(location.origin || '');
  const originalFetch = window.fetch.bind(window);

  const normalizeLocalApiUrl = (resource) => {
    let raw = null;

    if (typeof resource === 'string') raw = resource;
    else if (resource instanceof URL) raw = resource.href;
    else if (typeof Request !== 'undefined' && resource instanceof Request) raw = resource.url;
    else return null;

    try {
      const url = new URL(raw, LOCAL_ORIGIN);
      if (url.origin !== LOCAL_ORIGIN) return null;
      if (!url.pathname.startsWith('/api/')) return null;
      return `${API_ORIGIN}${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  };

  const optionsForNativeApi = (options = {}) => ({
    ...options,
    credentials: 'include'
  });

  window.fetch = (resource, options = {}) => {
    const target = normalizeLocalApiUrl(resource);
    if (!target) return originalFetch(resource, options);

    if (typeof Request !== 'undefined' && resource instanceof Request) {
      const method = String(resource.method || 'GET').toUpperCase();
      const merged = {
        method,
        headers: resource.headers,
        cache: resource.cache,
        redirect: resource.redirect,
        referrer: resource.referrer,
        referrerPolicy: resource.referrerPolicy,
        integrity: resource.integrity,
        keepalive: resource.keepalive,
        signal: resource.signal,
        ...options,
        credentials: 'include'
      };
      if (method !== 'GET' && method !== 'HEAD' && !('body' in options)) {
        merged.body = resource.body;
      }
      return originalFetch(target, merged);
    }

    return originalFetch(target, optionsForNativeApi(options));
  };

  window.__UNBOUND_NATIVE_API_TRANSPORT__ = Object.freeze({
    apiOrigin: API_ORIGIN,
    localOrigin: LOCAL_ORIGIN,
    mode: 'capacitor-http',
    credentials: 'include'
  });

  window.dispatchEvent(new CustomEvent('unbound:native-api-ready', {
    detail: { mode: 'capacitor-http' }
  }));
})();
