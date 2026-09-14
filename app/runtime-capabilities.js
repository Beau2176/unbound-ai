(() => {
  const native = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let microphonePermission = 'unknown';
  let microphoneWorking = Boolean(window.__UNBOUND_MICROPHONE_WORKING__);

  function wantsWebResearch(message) {
    const text = String(message || '').trim().toLowerCase();
    if (!text) return false;
    if (/\b(do not|don't|dont|without)\s+(search|browse|look up|research|check the web|use the web)\b/i.test(text)) return false;
    return /\b(latest|current|today|tonight|this week|this month|right now|up[- ]to[- ]date|news|search(?: the)? web|browse(?: the)? web|look (?:it )?up|look online|check online|check the web|research this|find online|verify online|web search|internet search)\b/i.test(text);
  }

  function deviceInspectionSummary() {
    const snapshot = window.__UNBOUND_DEVICE_INSPECTION__;
    if (!snapshot || typeof snapshot !== 'object') {
      return {
        source: null,
        browserInspectionAvailable: true,
        deepInspectionAvailable: false,
        permissionGranted: false,
        appCount: 0,
        processCount: 0,
        selectedFileCount: 0
      };
    }
    return {
      source: String(snapshot.source || '').slice(0,40) || null,
      browserInspectionAvailable: snapshot.browserInspectionAvailable !== false,
      deepInspectionAvailable: Boolean(snapshot.deepInspectionAvailable),
      permissionGranted: Boolean(snapshot.permissionGranted),
      appCount: Array.isArray(snapshot.apps) ? snapshot.apps.length : 0,
      processCount: Array.isArray(snapshot.processes) ? snapshot.processes.length : 0,
      selectedFileCount: Array.isArray(snapshot.selectedFiles) ? snapshot.selectedFiles.length : 0
    };
  }

  async function readMicrophonePermission() {
    if (microphoneWorking) {
      microphonePermission = 'granted';
      return microphonePermission;
    }
    if (!navigator.permissions?.query) return microphonePermission;
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      microphonePermission = status.state || 'unknown';
      status.addEventListener?.('change', () => {
        microphonePermission = microphoneWorking ? 'granted' : (status.state || 'unknown');
        snapshot();
      });
    } catch (_) {}
    return microphonePermission;
  }

  function snapshot() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    const micSupported = Boolean(navigator.mediaDevices?.getUserMedia || Recognition || microphoneWorking);
    const data = Object.freeze({
      secureContext: Boolean(window.isSecureContext),
      online: navigator.onLine !== false,
      microphoneSupported: micSupported,
      microphonePermission: microphoneWorking ? 'granted' : microphonePermission,
      speechRecognition: Boolean(Recognition),
      speechSynthesis: 'speechSynthesis' in window,
      audioPlayback: typeof window.Audio === 'function' || typeof window.HTMLAudioElement === 'function' || 'speechSynthesis' in window,
      nativeApp: native,
      platform: String(navigator.userAgentData?.platform || navigator.platform || (native ? 'native' : 'web')).slice(0, 60),
      hardwareConcurrency: Number(navigator.hardwareConcurrency || 0) || null,
      deviceMemoryGb: Number(navigator.deviceMemory || 0) || null,
      networkType: String(connection?.effectiveType || connection?.type || '').slice(0, 40) || null,
      formsOnPage: Math.min(document.forms?.length || 0, 1000),
      sameOriginFormInteraction: true,
      deviceInspection: deviceInspectionSummary()
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
      microphoneWorking = true;
      window.__UNBOUND_MICROPHONE_WORKING__ = true;
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

  function syntheticStreamFromJson(data, status = 200) {
    if (status < 200 || status >= 300) {
      const line = JSON.stringify({ type: 'error', error: data?.error || 'Web research request failed.' }) + '\n';
      return new Response(line, { status: 200, headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
    }
    const meta = {
      type: 'meta', depthStyle: data?.depthStyle, productMode: data?.productMode,
      aiStyle: data?.aiStyle, provider: data?.provider, model: data?.model,
      conversationId: data?.conversationId || null
    };
    const done = {
      type: 'done', depthStyle: data?.depthStyle, productMode: data?.productMode,
      aiStyle: data?.aiStyle, provider: data?.provider, model: data?.model,
      conversationId: data?.conversationId || null, sources: data?.sources || [],
      citations: data?.citations || [], webSearchCalls: data?.webSearchCalls || 0
    };
    const text = [
      JSON.stringify(meta),
      JSON.stringify({ type: 'delta', delta: String(data?.reply || '') }),
      JSON.stringify(done)
    ].join('\n') + '\n';
    return new Response(text, { status: 200, headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
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

          if (url.pathname === '/api/chat/stream' && wantsWebResearch(parsed.message)) {
            const researchResponse = await originalFetch('/api/chat', {
              ...init,
              headers: { ...(init.headers || {}), 'Content-Type': 'application/json', Accept: 'application/json' }
            });
            const data = await researchResponse.json().catch(() => ({ error: 'Web research returned an invalid response.' }));
            return syntheticStreamFromJson(data, researchResponse.status);
          }
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
    wantsWebResearch,
    get current() { return window.__UNBOUND_CLIENT_CAPABILITIES__ || snapshot(); }
  });

  window.addEventListener('online', snapshot);
  window.addEventListener('offline', snapshot);
  window.addEventListener('resize', snapshot);
  window.addEventListener('unbound:device-inspection', snapshot);
  window.addEventListener('unbound:microphone-state', (event) => {
    if (event?.detail?.working) {
      microphoneWorking = true;
      window.__UNBOUND_MICROPHONE_WORKING__ = true;
      microphonePermission = 'granted';
      snapshot();
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void refresh(), { once: true });
  } else {
    void refresh();
  }
})();
