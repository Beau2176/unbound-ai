(() => {
  'use strict';

  const VERSION = 'unbound-mobile-voice-fast-path-v4';
  const SAFE_AUTO_READ_STORAGE_KEY = 'unbound.voice.autoRead.safe.v2';
  const LEGACY_AUTO_READ_STORAGE_KEY = 'unbound.voice.autoRead';
  const CLOUD_SPEECH_URL = '/api/voice/natural-speech';
  const MAX_CHUNK = 160;
  const FALLBACK_CHUNK = 96;
  const VOICE_NAMES = ['Google US English', 'Sonia', 'Serena', 'Libby', 'Hazel', 'Susan'];

  const mobile = /Android|iPhone|iPad|iPod/i.test(String(navigator.userAgent || '')) ||
    Boolean(window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth <= 900);
  if (!mobile) return;
  if (window.__unboundMobileVoiceFastPath?.version === VERSION) return;

  let cachedVoice = null;
  let primed = false;
  let priming = false;
  let speaking = false;
  let manualPlayback = false;
  let generation = 0;
  let queue = [];
  let buffer = '';
  let sawStreamDelta = false;
  let activeAudio = null;
  let activeAudioUrl = '';
  let uiTimer = null;

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  }

  storageSet(LEGACY_AUTO_READ_STORAGE_KEY, 'false');

  function autoReadEnabled() {
    return storageGet(SAFE_AUTO_READ_STORAGE_KEY) === 'true';
  }

  function setAutoReadEnabled(enabled) {
    storageSet(SAFE_AUTO_READ_STORAGE_KEY, enabled ? 'true' : 'false');
    syncAutoReadButton();
  }

  function handsFreeActive() {
    return document.getElementById('unboundHandsFreeVoice')?.dataset.active === 'true';
  }

  function clean(value) {
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

  function voiceScore(voice) {
    const name = String(voice?.name || '');
    const lang = String(voice?.lang || '');
    let score = 0;
    if (/^en[-_]US$/i.test(lang)) score += 300;
    if (/google/i.test(name)) score += 120;
    if (/natural|neural|enhanced|premium/i.test(name)) score += 80;
    if (voice?.default) score += 20;
    return score;
  }

  function resolveVoice() {
    if (cachedVoice) return cachedVoice;
    if (!('speechSynthesis' in window)) return null;
    const all = window.speechSynthesis.getVoices() || [];
    const voices = all
      .filter((voice) => /^en[-_]US$/i.test(String(voice.lang || '')))
      .slice()
      .sort((a, b) => voiceScore(b) - voiceScore(a));
    for (const preferred of VOICE_NAMES) {
      const wanted = preferred.toLowerCase();
      const match = voices.find((voice) => String(voice.name || '').toLowerCase().includes(wanted));
      if (match) return (cachedVoice = match);
    }
    return (cachedVoice = voices[0] || null);
  }

  function prime() {
    if (primed || priming || speaking || !('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return;
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) return;
    const voice = resolveVoice();
    const warmup = new window.SpeechSynthesisUtterance('.');
    if (voice) warmup.voice = voice;
    warmup.lang = 'en-US';
    warmup.rate = 10;
    warmup.pitch = 1;
    warmup.volume = 0;
    const finish = () => { priming = false; primed = true; };
    warmup.onstart = () => { primed = true; };
    warmup.onend = finish;
    warmup.onerror = () => { priming = false; };
    priming = true;
    try { synth.speak(warmup); } catch (_) { priming = false; }
  }

  function split(text) {
    const words = clean(text).split(/\s+/).filter(Boolean);
    const chunks = [];
    let current = '';
    for (const word of words) {
      if (word.length > MAX_CHUNK) {
        if (current) chunks.push(current);
        current = '';
        for (let offset = 0; offset < word.length; offset += MAX_CHUNK) chunks.push(word.slice(offset, offset + MAX_CHUNK));
        continue;
      }
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= MAX_CHUNK) current = candidate;
      else {
        if (current) chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function stopCloudAudio() {
    if (activeAudio) {
      try { activeAudio.pause(); activeAudio.currentTime = 0; } catch (_) {}
      activeAudio = null;
    }
    if (activeAudioUrl) {
      try { URL.revokeObjectURL(activeAudioUrl); } catch (_) {}
      activeAudioUrl = '';
    }
  }

  function reset({ cancelSpeech = true } = {}) {
    generation += 1;
    queue = [];
    buffer = '';
    sawStreamDelta = false;
    speaking = false;
    manualPlayback = false;
    stopCloudAudio();
    if (cancelSpeech && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }

  function speakNext() {
    if (speaking || !queue.length || handsFreeActive()) return;
    if (!manualPlayback && !autoReadEnabled()) return;
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return;

    const token = generation;
    const text = queue.shift();
    const voice = resolveVoice();
    const utterance = new window.SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    speaking = true;
    utterance.onstart = () => { primed = true; priming = false; };
    utterance.onend = () => {
      if (token !== generation) return;
      speaking = false;
      if (!queue.length) manualPlayback = false;
      window.setTimeout(speakNext, 15);
    };
    utterance.onerror = () => { speaking = false; manualPlayback = false; };
    try { window.speechSynthesis.speak(utterance); } catch (_) { speaking = false; manualPlayback = false; }
  }

  function enqueue(text) {
    const chunks = split(text);
    if (!chunks.length) return;
    queue.push(...chunks);
    speakNext();
  }

  function speakLocal(text) {
    reset();
    manualPlayback = true;
    prime();
    enqueue(text);
    return true;
  }

  function drain(force = false) {
    while (buffer) {
      const sentence = buffer.match(/^([\s\S]*?[.!?])(?:\s+|$)/);
      if (sentence) {
        enqueue(sentence[1]);
        buffer = buffer.slice(sentence[0].length);
        continue;
      }
      if (force) {
        enqueue(buffer);
        buffer = '';
        continue;
      }
      if (buffer.length >= FALLBACK_CHUNK) {
        let cut = Math.min(MAX_CHUNK, buffer.length);
        const space = buffer.lastIndexOf(' ', cut);
        if (space >= FALLBACK_CHUNK) cut = space;
        enqueue(buffer.slice(0, cut));
        buffer = buffer.slice(cut).trimStart();
        continue;
      }
      break;
    }
  }

  function onStream(event) {
    if (!autoReadEnabled() || handsFreeActive()) return;
    const detail = event?.detail || {};
    if (detail.start) {
      reset();
      prime();
    }
    if (typeof detail.delta === 'string' && detail.delta) {
      sawStreamDelta = true;
      buffer += detail.delta;
    }
    if (detail.done && !sawStreamDelta && typeof detail.text === 'string' && !buffer) buffer = detail.text;
    drain(Boolean(detail.done));
  }

  function canonicalAssistantText() {
    const nodes = Array.from(document.querySelectorAll('.message.assistant'));
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node.classList.contains('error') || node.querySelector('.typing')) continue;
      const canonical = String(node.dataset.speechText || '').trim();
      if (canonical) return clean(canonical);
      const fallback = clean(node.innerText || node.textContent || '');
      if (fallback) return fallback;
    }
    return '';
  }

  function selectedPreset() {
    return String(document.getElementById('unboundVoicePreset')?.value || 'clear').trim().toLowerCase() || 'clear';
  }

  function setNote(message) {
    const note = document.querySelector('.unbound-voice-picker-note');
    if (note) note.textContent = message;
  }

  async function speakSelected(text) {
    const preset = selectedPreset();
    if (preset === 'clear') {
      setNote('Reading the raw UNBOUND answer with Voice 2 — Clear (U.S. English).');
      return speakLocal(text);
    }

    reset();
    const token = generation;
    try {
      setNote('Loading the selected voice…');
      const response = await fetch(CLOUD_SPEECH_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean(text).slice(0, 4096), preset, locale: 'en-US' })
      });
      if (token !== generation) return false;
      if (!response.ok) throw new Error('cloud voice unavailable');
      const blob = await response.blob();
      if (token !== generation || !blob?.size) return false;
      activeAudioUrl = URL.createObjectURL(blob);
      activeAudio = new Audio(activeAudioUrl);
      activeAudio.onended = stopCloudAudio;
      activeAudio.onerror = stopCloudAudio;
      await activeAudio.play();
      return true;
    } catch (_) {
      if (token !== generation) return false;
      setNote('Cloud voice was unavailable, so UNBOUND is using Voice 2 — Clear (U.S. English).');
      return speakLocal(text);
    }
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
      const voice = (payload?.access?.capabilities || []).find((item) => item?.key === 'voice');
      return { allowed: Boolean(voice?.usable), message: voice?.usable ? '' : 'Auto-Read Replies requires Premium or Ultra Voice access.' };
    } catch (_) {
      return { allowed: false, message: 'Could not verify Voice access right now.' };
    }
  }

  function syncAutoReadButton() {
    const action = document.getElementById('unboundVoiceAutoRead');
    if (!action) return;
    const enabled = autoReadEnabled();
    const text = enabled ? '🔊 Auto-read new replies: ON' : '🔊 Auto-read new replies: OFF';
    if (action.textContent !== text) action.textContent = text;
    action.dataset.autoRead = enabled ? 'true' : 'false';
    action.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }

  async function toggleAutoRead() {
    if (autoReadEnabled()) {
      setAutoReadEnabled(false);
      reset();
      setNote('Auto-read is off.');
      return;
    }
    setNote('Checking Voice access…');
    const access = await hasVoiceAccess();
    if (!access.allowed) {
      setAutoReadEnabled(false);
      setNote(access.message || 'Auto-read is unavailable.');
      return;
    }
    setAutoReadEnabled(true);
    prime();
    setNote('Auto-read is on. Mobile will read replies in U.S. English.');
  }

  function closeVoiceMenu() {
    const button = document.getElementById('unboundVoiceListenButton');
    const menu = button?.closest('.voice-listen-wrap')?.querySelector('.voice-listen-menu');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function handleCapturedClick(event) {
    const target = event.target;
    const autoRead = target?.closest?.('#unboundVoiceAutoRead');
    if (autoRead) {
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
    const text = canonicalAssistantText();
    if (!text) {
      setNote('There is no completed UNBOUND AI answer to read yet.');
      return;
    }
    void speakSelected(text);
  }

  document.addEventListener('click', handleCapturedClick, true);
  document.addEventListener('pointerdown', prime, { passive: true, capture: true, once: true });
  document.addEventListener('touchstart', prime, { passive: true, capture: true, once: true });
  window.addEventListener('unbound:assistant-stream', onStream);

  if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      cachedVoice = null;
      resolveVoice();
    });
  }

  uiTimer = window.setInterval(syncAutoReadButton, 400);
  window.setTimeout(syncAutoReadButton, 250);
  window.__unboundMobileVoiceFastPath = {
    version: VERSION,
    prime,
    reset,
    syncAutoReadButton,
    isMobile: true,
    get uiTimer() { return uiTimer; }
  };
})();