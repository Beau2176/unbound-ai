(() => {
  'use strict';

  const VERSION = 'unbound-voice-readability-v100';
  const AUTO_READ_STORAGE_KEY = 'unbound.voice.autoRead.v2';
  const LEGACY_AUTO_READ_STORAGE_KEY = 'unbound.voice.autoRead';
  const AUTO_READ_SETTLE_MS = 850;
  const CLEAR_VOICE_NAMES = ['Google US English', 'Sonia', 'Serena', 'Libby', 'Hazel', 'Susan'];
  const CLOUD_SPEECH_URL = '/api/voice/natural-speech';

  let speaking = false;
  let speechGeneration = 0;
  let cloudAudio = null;
  let cloudAudioUrl = '';
  let cachedVoice = null;
  let autoReadEnabled = false;
  let autoReadSawBusy = false;
  let autoReadLastText = '';
  let autoReadTimer = null;
  let observer = null;

  function safeStorageGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeStorageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  }

  function migrateAutoReadPreference() {
    const current = safeStorageGet(AUTO_READ_STORAGE_KEY);
    const legacy = safeStorageGet(LEGACY_AUTO_READ_STORAGE_KEY);
    autoReadEnabled = current === 'true' || (current === null && legacy === 'true');
    safeStorageSet(AUTO_READ_STORAGE_KEY, autoReadEnabled ? 'true' : 'false');
    // Keep the older reader disabled. This script owns auto-read now so two engines never speak at once.
    safeStorageSet(LEGACY_AUTO_READ_STORAGE_KEY, 'false');
  }

  function cleanSpeechText(value) {
    return String(value || '')
      .replace(/\[Response interrupted before completion\.\]/gi, ' ')
      .replace(/https?:\/\/\S+/gi, ' link ')
      .replace(/\[(?:source\s*)?\d{1,3}\]/gi, ' ')
      .replace(/`{1,3}/g, ' ')
      .replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu, ' ')
      .replace(/[*_#>|~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractSpeechText(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    for (const selector of [
      '.message-sources',
      '.inline-citation',
      '.typing',
      'button',
      '[role="button"]',
      'audio',
      'video',
      'svg',
      'script',
      'style',
      '[data-speech-ignore="true"]'
    ]) {
      for (const child of clone.querySelectorAll(selector)) child.remove();
    }
    return cleanSpeechText(clone.innerText || clone.textContent || '');
  }

  function getLastAssistantText() {
    const selectors = [
      '[data-role="assistant"]',
      '.message.assistant',
      '.assistant-message',
      '.messages .assistant',
      '.messages .message'
    ];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        const role = String(node.getAttribute('data-role') || '').toLowerCase();
        const className = String(node.className || '').toLowerCase();
        if (selector === '.messages .message' && !(role === 'assistant' || className.includes('assistant') || className.includes('ai'))) continue;
        if (node.classList?.contains('error')) continue;
        const text = extractSpeechText(node);
        if (text) return text;
      }
    }
    return '';
  }

  function hardSplit(text, maxLength) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const pieces = [];
    let current = '';
    for (const word of words) {
      if (word.length > maxLength) {
        if (current) pieces.push(current);
        for (let offset = 0; offset < word.length; offset += maxLength) {
          pieces.push(word.slice(offset, offset + maxLength));
        }
        current = '';
        continue;
      }
      const combined = current ? `${current} ${word}` : word;
      if (combined.length <= maxLength) current = combined;
      else {
        if (current) pieces.push(current);
        current = word;
      }
    }
    if (current) pieces.push(current);
    return pieces;
  }

  function splitSpeechText(value) {
    const text = cleanSpeechText(value);
    if (!text) return [];
    const android = /Android/i.test(navigator.userAgent || '');
    const maxLength = android ? 180 : 360;
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const chunks = [];
    let current = '';
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      if (sentence.length > maxLength) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        chunks.push(...hardSplit(sentence, maxLength));
        continue;
      }
      const combined = current ? `${current} ${sentence}` : sentence;
      if (combined.length <= maxLength) current = combined;
      else {
        if (current) chunks.push(current);
        current = sentence;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function voiceScore(voice) {
    const name = String(voice?.name || '');
    const lang = String(voice?.lang || '');
    let score = 0;
    if (/^en-US$/i.test(lang)) score += 220;
    else if (/^en(?:-|$)/i.test(lang)) score += 120;
    if (voice?.localService) score += 90;
    if (/google/i.test(name)) score += 80;
    if (/natural|neural|enhanced|premium/i.test(name)) score += 70;
    if (voice?.default) score += 20;
    return score;
  }

  function resolveClearVoice() {
    if (cachedVoice) return cachedVoice;
    if (!('speechSynthesis' in window)) return null;
    const all = window.speechSynthesis.getVoices() || [];
    const english = all.filter((voice) => /^en(?:-|$)/i.test(String(voice.lang || '')));
    const voices = (english.length ? english : all).slice().sort((a, b) => voiceScore(b) - voiceScore(a));
    for (const preferred of CLEAR_VOICE_NAMES) {
      const wanted = preferred.toLowerCase();
      const match = voices.find((voice) => String(voice.name || '').toLowerCase().includes(wanted));
      if (match) {
        cachedVoice = match;
        return cachedVoice;
      }
    }
    cachedVoice = voices[0] || null;
    return cachedVoice;
  }

  function stopCloudAudio() {
    if (cloudAudio) {
      try {
        cloudAudio.pause();
        cloudAudio.currentTime = 0;
      } catch (_) {}
      cloudAudio = null;
    }
    if (cloudAudioUrl) {
      try { URL.revokeObjectURL(cloudAudioUrl); } catch (_) {}
      cloudAudioUrl = '';
    }
  }

  function stopSpeech() {
    speechGeneration += 1;
    speaking = false;
    stopCloudAudio();
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }

  function speakBrowser(text, onDone) {
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return false;
    const chunks = splitSpeechText(text);
    if (!chunks.length) return false;

    stopSpeech();
    speaking = true;
    const token = speechGeneration;
    const synth = window.speechSynthesis;
    const voice = resolveClearVoice();
    let index = 0;

    function finish() {
      if (token !== speechGeneration) return;
      speaking = false;
      if (typeof onDone === 'function') onDone();
    }

    function next() {
      if (!speaking || token !== speechGeneration) return;
      if (index >= chunks.length) return finish();
      if (synth.paused) {
        try { synth.resume(); } catch (_) {}
      }
      const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'en-US';
      utterance.rate = 0.98;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onend = () => {
        index += 1;
        window.setTimeout(next, /Android/i.test(navigator.userAgent || '') ? 55 : 20);
      };
      utterance.onerror = () => finish();
      try { synth.speak(utterance); } catch (_) { finish(); }
    }

    next();
    return true;
  }

  function selectedPreset() {
    return String(document.getElementById('unboundVoicePreset')?.value || 'clear').trim().toLowerCase() || 'clear';
  }

  function setNote(message) {
    const note = document.querySelector('.unbound-voice-picker-note');
    if (note) note.textContent = message;
  }

  async function speakCloud(text, preset) {
    const cleaned = cleanSpeechText(text).slice(0, 4096);
    if (!cleaned) return false;
    stopSpeech();
    const token = speechGeneration;
    try {
      const response = await fetch(CLOUD_SPEECH_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleaned, preset })
      });
      if (token !== speechGeneration) return false;
      if (!response.ok) throw new Error('cloud voice unavailable');
      const blob = await response.blob();
      if (token !== speechGeneration || !blob?.size) return false;
      cloudAudioUrl = URL.createObjectURL(blob);
      cloudAudio = new Audio(cloudAudioUrl);
      cloudAudio.onended = stopCloudAudio;
      cloudAudio.onerror = stopCloudAudio;
      await cloudAudio.play();
      return true;
    } catch (_) {
      if (token !== speechGeneration) return false;
      setNote('Cloud voice was unavailable, so UNBOUND is using Voice 2 — Clear.');
      return speakBrowser(cleaned);
    }
  }

  function speakSelected(text) {
    const preset = selectedPreset();
    if (preset === 'clear') return speakBrowser(text);
    void speakCloud(text, preset);
    return true;
  }

  function closeVoiceMenu() {
    const button = document.getElementById('unboundVoiceListenButton');
    const menu = button?.closest('.voice-listen-wrap')?.querySelector('.voice-listen-menu');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function isManualListenTarget(target) {
    const action = target?.closest?.('.voice-listen-action');
    return action && /Listen to last answer/i.test(String(action.textContent || '')) ? action : null;
  }

  function syncAutoReadButton() {
    const action = document.getElementById('unboundVoiceAutoRead');
    if (!action) return;
    action.dataset.autoRead = autoReadEnabled ? 'true' : 'false';
    action.setAttribute('aria-pressed', autoReadEnabled ? 'true' : 'false');
    action.textContent = autoReadEnabled ? '🔊 Auto-read new replies: ON' : '🔊 Auto-read new replies: OFF';
    action.title = 'Automatically read completed UNBOUND AI replies using clean answer text.';
  }

  async function hasVoiceAccess() {
    try {
      const response = await fetch('/api/account/access', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return { allowed: false, message: response.status === 401 ? 'Sign in before enabling Auto-Read Replies.' : (payload.error || 'Could not verify Voice access.') };
      const capabilities = payload?.access?.capabilities || [];
      const voice = capabilities.find((item) => item?.key === 'voice');
      return { allowed: Boolean(voice?.usable), message: voice?.usable ? '' : 'Auto-Read Replies requires Premium or Ultra Voice access.' };
    } catch (_) {
      return { allowed: false, message: 'Could not verify Voice access right now.' };
    }
  }

  function sendIsBusy() {
    const send = document.getElementById('sendButton') || document.querySelector('.send, button[type="submit"]');
    return Boolean(send?.disabled);
  }

  function maybeAutoRead() {
    if (!autoReadEnabled || document.getElementById('unboundHandsFreeVoice')?.dataset.active === 'true') return;
    if (sendIsBusy()) {
      autoReadSawBusy = true;
      scheduleAutoRead(250);
      return;
    }
    if (!autoReadSawBusy) return;
    const text = getLastAssistantText();
    autoReadSawBusy = false;
    if (!text || text === autoReadLastText || /Response interrupted before completion/i.test(text)) return;
    autoReadLastText = text;
    setNote('Reading the completed answer with clean Voice 2 — Clear text.');
    speakBrowser(text);
  }

  function scheduleAutoRead(delay = AUTO_READ_SETTLE_MS) {
    if (!autoReadEnabled) return;
    if (autoReadTimer) window.clearTimeout(autoReadTimer);
    autoReadTimer = window.setTimeout(() => {
      autoReadTimer = null;
      maybeAutoRead();
    }, delay);
  }

  async function toggleAutoRead() {
    if (autoReadEnabled) {
      autoReadEnabled = false;
      autoReadSawBusy = false;
      safeStorageSet(AUTO_READ_STORAGE_KEY, 'false');
      syncAutoReadButton();
      setNote('Auto-read is off.');
      return;
    }
    setNote('Checking Voice access…');
    const access = await hasVoiceAccess();
    if (!access.allowed) {
      autoReadEnabled = false;
      safeStorageSet(AUTO_READ_STORAGE_KEY, 'false');
      syncAutoReadButton();
      setNote(access.message || 'Auto-read is unavailable.');
      return;
    }
    autoReadEnabled = true;
    autoReadSawBusy = false;
    autoReadLastText = getLastAssistantText();
    safeStorageSet(AUTO_READ_STORAGE_KEY, 'true');
    syncAutoReadButton();
    setNote('Auto-read is on. Completed replies will be read from the answer text only.');
  }

  function handleCapturedClick(event) {
    const autoReadAction = event.target?.closest?.('#unboundVoiceAutoRead');
    if (autoReadAction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void toggleAutoRead();
      return;
    }

    const listenAction = isManualListenTarget(event.target);
    if (!listenAction) return;
    const text = getLastAssistantText();
    event.preventDefault();
    event.stopImmediatePropagation();
    closeVoiceMenu();
    if (!text) {
      setNote('There is no completed UNBOUND AI answer to read yet.');
      return;
    }
    setNote('Reading the answer text only.');
    speakSelected(text);
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => {
      syncAutoReadButton();
      scheduleAutoRead();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled']
    });
  }

  function boot() {
    if (window.__unboundVoiceReadabilityFix === VERSION) return;
    window.__unboundVoiceReadabilityFix = VERSION;
    migrateAutoReadPreference();
    document.addEventListener('click', handleCapturedClick, true);
    if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', () => { cachedVoice = null; resolveClearVoice(); });
    }
    autoReadLastText = getLastAssistantText();
    startObserver();
    syncAutoReadButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
