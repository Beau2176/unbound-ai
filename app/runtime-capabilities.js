(() => {
  const native = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let microphonePermission = 'unknown';

  async function readMicrophonePermission() {
    if (!navigator.permissions?.query) return microphonePermission;
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      microphonePermission = status.state || 'unknown';
      status.addEventListener?.('change', () => {
        microphonePermission = status.state || 'unknown';
        refresh();
      });
    } catch (_) {}
    return microphonePermission;
  }

  function snapshot() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    const data = Object.freeze({
      secureContext: Boolean(window.isSecureContext),
      online: navigator.onLine !== false,
      microphoneSupported: Boolean(navigator.mediaDevices?.getUserMedia),
      microphonePermission,
      speechRecognition: Boolean(Recognition),
      speechSynthesis: 'speechSynthesis' in window,
      audioPlayback: typeof window.Audio === 'function',
      nativeApp: native,
      platform: String(navigator.userAgentData?.platform || navigator.platform || (native ? 'native' : 'web')).slice(0, 60),
      hardwareConcurrency: Number(navigator.hardwareConcurrency || 0) || null,
      deviceMemoryGb: Number(navigator.deviceMemory || 0) || null,
      networkType: String(connection?.effectiveType || connection?.type || '').slice(0, 40) || null,
      formsOnPage: Math.min(document.forms?.length || 0, 1000),
      sameOriginFormInteraction: true
    });
    window.__UNBOUND_CLIENT_CAPABILITIES__ = data;
    window.dispatchEvent(new CustomEvent('unbound:client-capabilities', { detail: data }));
    return data;
  }

  async function refresh() {
    await readMicrophonePermission();
    return snapshot();
  }

  async function requestMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is not supported by this browser.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      microphonePermission = 'granted';
      return snapshot();
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  }

  function speak(text) {
    const value = String(text || '').trim();
    if (!value || !('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(value));
    return true;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function unboundCapabilityAwareFetch(input, init = {}) {
    try {
      const urlValue = typeof input === 'string' ? input : input?.url;
      const url = new URL(urlValue, location.href);
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const isChat = url.origin === location.origin && (url.pathname === '/api/chat' || url.pathname === '/api/chat/stream');
      if (isChat && method === 'POST' && typeof init?.body === 'string') {
        const parsed = JSON.parse(init.body);
        if (parsed && typeof parsed === 'object') {
          parsed.clientCapabilities = snapshot();
          init = { ...init, body: JSON.stringify(parsed) };
        }
      }
    } catch (_) {}
    return originalFetch(input, init);
  };

  window.UNBOUND_RUNTIME_CAPABILITIES = Object.freeze({
    refresh,
    snapshot,
    requestMicrophone,
    speak,
    get current() { return window.__UNBOUND_CLIENT_CAPABILITIES__ || snapshot(); }
  });

  window.addEventListener('online', snapshot);
  window.addEventListener('offline', snapshot);
  window.addEventListener('resize', snapshot);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void refresh(), { once: true });
  } else {
    void refresh();
  }
})();
