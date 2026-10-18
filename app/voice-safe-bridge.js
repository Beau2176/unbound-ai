(() => {
  'use strict';

  const VERSION = 'unbound-voice-safe-bridge-v201';
  const LEGACY_AUTO_READ_STORAGE_KEY = 'unbound.voice.autoRead';
  const SAFE_AUTO_READ_STORAGE_KEY = 'unbound.voice.autoRead.safe.v2';
  const VOICE_STORAGE_KEY = 'unbound.voice.systemVoiceURI';
  const MAX_UTTERANCE_LENGTH = 220;
  const POLL_MS = 450;
  const SETTLE_MS = 650;

  let speechGeneration = 0;
  let browserSpeaking = false;
  let autoReadEnabled = false;
  let autoReadSawBusy = false;
  let autoReadLastText = '';
  let settleTimer = null;
  let pollTimer = null;

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  }

  function migrateAutoReadPreference() {
    const safe = storageGet(SAFE_AUTO_READ_STORAGE_KEY);
    const legacy = storageGet(LEGACY_AUTO_READ_STORAGE_KEY);
    autoReadEnabled = safe === 'true' || (safe === null && legacy === 'true');
    storageSet(SAFE_AUTO_READ_STORAGE_KEY, autoReadEnabled ? 'true' : 'false');

    // The original reader uses a broad DOM MutationObserver. Keep it disabled.
    storageSet(LEGACY_AUTO_READ_STORAGE_KEY, 'false');
  }

  function cleanSpeechText(value) {
    return String(value || '')
      .replace(/\[Response interrupted before completion\.\]/gi, ' ')
      .replace(/\[Stream interrupted:[^\]]*\]/gi, ' ')
      .replace(/https?:\/\/\S+/gi, ' link ')
      .replace(/\[(?:source\s*)?\d{1,3}\]/gi, ' ')
      .replace(/`{1,3}/g, ' ')
      .replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu, ' ')
      .replace(/[*_#>|~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractAssistantText(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    const ignored = [
      '.message-sources',
      '.inline-citation',
      '.source-link',
      '.typing',
      'button',
      '[role="button"]',
      '[hidden]',
      '[aria-hidden="true"]',
      'audio',
      'video',
      'svg',
      'script',
      'style'
    ];

    for (const selector of ignored) {
      for (const child of clone.querySelectorAll(selector)) child.remove();
    }

    return cleanSpeechText(clone.innerText || clone.textContent || '');
  }

  function getLastAssistantText() {
    const nodes = Array.from(document.querySelectorAll('.message.assistant'));
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node.classList.contains('error')) continue;
      if (node.querySelector('.typing')) continue;
      const text = extractAssistantText(node);
      if (text) return text;
    }
    return '';
  }

  function hardSplit(text, maxLength = MAX_UTTERANCE_LENGTH) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const chunks = [];
    let current = '';

    for (const word of words) {
      if (word.length > maxLength) {
        if (current) chunks.push(current);
        for (let offset = 0; offset < word.length; offset += maxLength) {
          chunks.push(word.slice(offset, offset + maxLength));
        }
        current = '';
        continue;
      }

      const combined = current ? `${current} ${word}` : word;
      if (combined.length <= maxLength) {
        current = combined;
      } else {
        if (current) chunks.push(current);
        current = word;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  function splitSpeechText(value) {
    const text = cleanSpeechText(value);
    if (!text) return [];

    const sentences = text.match(/.+?(?:[.!?](?=\s|$)|$)/g) || [text];
    const chunks = [];
    let current = '';

    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;

      if (sentence.length > MAX_UTTERANCE_LENGTH) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        chunks.push(...hardSplit(sentence));
        continue;
      }

      const combined = current ? `${current} ${sentence}` : sentence;
      if (combined.length <= MAX_UTTERANCE_LENGTH) {
        current = combined;
      } else {
        if (current) chunks.push(current);
        current = sentence;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  function resolveVoice() {
    if (!('speechSynthesis' in window)) return null;
    try {
      const selected = window.__unboundDeviceVoice?.getVoice?.();
      if (selected) return selected;
    } catch (_) {}

    let voices;
    try { voices = window.speechSynthesis.getVoices() || []; }
    catch (_) { return null; }
    const wanted = String(document.getElementById('unboundVoicePreset')?.value || storageGet(VOICE_STORAGE_KEY) || '').trim();
    const key = (voice) => JSON.stringify([
      String(voice?.voiceURI || ''), String(voice?.name || ''),
      String(voice?.lang || ''), Boolean(voice?.localService)
    ]);
    return voices.find((voice) => key(voice) === wanted)
      || voices.find((voice) => String(voice?.voiceURI || '') === wanted)
      || voices.find((voice) => String(voice?.name || '') === wanted)
      || voices.find((voice) => voice?.default)
      || voices[0] || null;
  }

  function stopPlayback() {
    speechGeneration += 1;
    browserSpeaking = false;
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }

  function speakBrowser(text) {
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') {
      return false;
    }

    const chunks = splitSpeechText(text);
    if (!chunks.length) return false;

    stopPlayback();
    const token = speechGeneration;
    const synth = window.speechSynthesis;
    const voice = resolveVoice();
    let index = 0;
    browserSpeaking = true;

    const next = () => {
      if (!browserSpeaking || token !== speechGeneration) return;
      if (index >= chunks.length) {
        browserSpeaking = false;
        return;
      }

      const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'en-US';
      if (voice?.voiceURI) {
        try { utterance.voiceURI = voice.voiceURI; } catch (_) {}
      }
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onend = () => {
        if (token !== speechGeneration) return;
        index += 1;
        window.setTimeout(next, 35);
      };
      utterance.onerror = () => {
        if (token !== speechGeneration) return;
        browserSpeaking = false;
      };

      try { synth.speak(utterance); }
      catch (_) { browserSpeaking = false; }
    };

    next();
    return true;
  }

  function setNote(message) {
    const note = document.querySelector('.unbound-voice-picker-note');
    if (note && note.textContent !== message) note.textContent = message;
  }

  function closeVoiceMenu() {
    const button = document.getElementById('unboundVoiceListenButton');
    const menu = button?.closest('.voice-listen-wrap')?.querySelector('.voice-listen-menu');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  async function hasVoiceAccess() {
    try {
      const response = await window.fetch('/api/account/access', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          allowed: false,
          message: response.status === 401
            ? 'Sign in before enabling Auto-Read Replies.'
            : (payload.error || 'Could not verify Voice access.')
        };
      }
      const capabilities = payload?.access?.capabilities || [];
      const voice = capabilities.find((item) => item?.key === 'voice');
      return {
        allowed: Boolean(voice?.usable),
        message: voice?.usable ? '' : 'Auto-Read Replies requires Premium or Ultra Voice access.'
      };
    } catch (_) {
      return { allowed: false, message: 'Could not verify Voice access right now.' };
    }
  }

  function syncAutoReadButton() {
    const action = document.getElementById('unboundVoiceAutoRead');
    if (!action) return;
    const expectedText = autoReadEnabled
      ? '🔊 Auto-read new replies: ON'
      : '🔊 Auto-read new replies: OFF';
    if (action.textContent !== expectedText) action.textContent = expectedText;
    const expected = autoReadEnabled ? 'true' : 'false';
    if (action.dataset.autoRead !== expected) action.dataset.autoRead = expected;
    if (action.getAttribute('aria-pressed') !== expected) action.setAttribute('aria-pressed', expected);
  }

  async function toggleAutoRead() {
    if (autoReadEnabled) {
      autoReadEnabled = false;
      autoReadSawBusy = false;
      storageSet(SAFE_AUTO_READ_STORAGE_KEY, 'false');
      syncAutoReadButton();
      setNote('Auto-read is off.');
      return;
    }

    setNote('Checking Voice access…');
    const access = await hasVoiceAccess();
    if (!access.allowed) {
      autoReadEnabled = false;
      storageSet(SAFE_AUTO_READ_STORAGE_KEY, 'false');
      syncAutoReadButton();
      setNote(access.message || 'Auto-read is unavailable.');
      return;
    }

    autoReadEnabled = true;
    autoReadSawBusy = false;
    autoReadLastText = getLastAssistantText();
    storageSet(SAFE_AUTO_READ_STORAGE_KEY, 'true');
    syncAutoReadButton();
    setNote('Auto-read is on. UNBOUND will read the answer text only.');
  }

  function sendIsBusy() {
    const send = document.getElementById('sendButton') || document.querySelector('.send, button[type="submit"]');
    return Boolean(send?.disabled);
  }

  function readCompletedReply() {
    if (!autoReadEnabled) return;
    if (document.getElementById('unboundHandsFreeVoice')?.dataset.active === 'true') return;
    const text = getLastAssistantText();
    if (!text || text === autoReadLastText) return;
    autoReadLastText = text;
    setNote('Reading the completed answer text.');
    speakBrowser(text);
  }

  function pollAutoRead() {
    syncAutoReadButton();
    if (!autoReadEnabled) return;

    if (sendIsBusy()) {
      autoReadSawBusy = true;
      if (settleTimer) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
      return;
    }

    if (!autoReadSawBusy) return;
    autoReadSawBusy = false;
    if (settleTimer) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      readCompletedReply();
    }, SETTLE_MS);
  }

  function handleCapturedClick(event) {
    const target = event.target;
    const autoReadAction = target?.closest?.('#unboundVoiceAutoRead');
    if (autoReadAction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void toggleAutoRead();
      return;
    }

    const action = target?.closest?.('.voice-listen-action');
    if (!action || !/Listen to last answer/i.test(String(action.textContent || ''))) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    closeVoiceMenu();

    const text = getLastAssistantText();
    if (!text) {
      setNote('There is no completed UNBOUND AI answer to read yet.');
      return;
    }

    setNote('Reading the answer text only.');
    speakBrowser(text);
  }

  function boot() {
    if (window.__unboundSafeVoiceBridge?.version === VERSION) return;

    migrateAutoReadPreference();
    autoReadLastText = getLastAssistantText();
    document.addEventListener('click', handleCapturedClick, true);

    pollTimer = window.setInterval(pollAutoRead, POLL_MS);
    window.setTimeout(syncAutoReadButton, 250);
    window.setTimeout(syncAutoReadButton, 1000);

    window.__unboundSafeVoiceBridge = {
      version: VERSION,
      cleanSpeechText,
      splitSpeechText,
      getLastAssistantText,
      stopPlayback,
      dispose() {
        document.removeEventListener('click', handleCapturedClick, true);
        if (pollTimer) window.clearInterval(pollTimer);
        if (settleTimer) window.clearTimeout(settleTimer);
        pollTimer = null;
        settleTimer = null;
        stopPlayback();
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
