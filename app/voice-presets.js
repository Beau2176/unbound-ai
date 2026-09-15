(() => {
  'use strict';

  const STYLE_ID = 'unbound-device-voices-v2';
  const SELECT_ID = 'unboundVoicePreset';
  const VOICE_STORAGE_KEY = 'unbound.voice.systemVoiceURI';
  const AUTO_READ_ACTION_ID = 'unboundVoiceAutoRead';
  const AUTO_READ_STORAGE_KEY = 'unbound.voice.autoRead';
  const AUTO_READ_SETTLE_MS = 700;
  const NORMAL_NOTE = 'Playback uses a voice exposed by this phone or computer. The selected voice\'s own language tag is used only to activate that exact OS voice on Android; the phone/browser language setting is not used.';

  let speaking = false;
  let priming = false;
  let enginePrimed = false;
  let selectedVoiceKey = '';
  let cachedVoice = null;
  let previewStartedOnPointerDown = false;
  let noteTimer = null;
  let autoReadEnabled = false;
  let autoReadTimer = null;
  let autoReadObserver = null;
  let autoReadLastText = '';
  let autoReadSawBusy = false;

  function storageGet(key) {
    try { return String(window.localStorage.getItem(key) || ''); } catch (_) { return ''; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, String(value || '')); } catch (_) {}
  }

  function voiceKey(voice) {
    return JSON.stringify([
      String(voice?.voiceURI || ''),
      String(voice?.name || ''),
      String(voice?.lang || ''),
      Boolean(voice?.localService)
    ]);
  }

  function findVoiceByKey(voices, key) {
    const wanted = String(key || '').trim();
    if (!wanted) return null;
    return voices.find((voice) => voiceKey(voice) === wanted)
      || voices.find((voice) => String(voice?.voiceURI || '').trim() === wanted)
      || voices.find((voice) => String(voice?.name || '').trim() === wanted)
      || null;
  }

  function applyVoice(utterance, voice) {
    if (!utterance || !voice) return;
    utterance.voice = voice;
    const lang = String(voice?.lang || '').trim();
    if (lang) utterance.lang = lang;
    const uri = String(voice?.voiceURI || '').trim();
    if (uri) {
      try { utterance.voiceURI = uri; } catch (_) {}
    }
  }

  function systemVoices() {
    if (!('speechSynthesis' in window)) return [];
    try { return (window.speechSynthesis.getVoices() || []).slice(); }
    catch (_) { return []; }
  }

  function resolveVoice() {
    const voices = systemVoices();
    if (!voices.length) {
      cachedVoice = null;
      return null;
    }

    const wanted = selectedVoiceKey || storageGet(VOICE_STORAGE_KEY);
    let voice = findVoiceByKey(voices, wanted);
    if (!voice) voice = voices.find((item) => item?.default) || voices[0] || null;
    cachedVoice = voice;
    selectedVoiceKey = voiceKey(voice);
    if (selectedVoiceKey) storageSet(VOICE_STORAGE_KEY, selectedVoiceKey);
    return cachedVoice;
  }

  function currentVoice() {
    const wanted = selectedVoiceKey || storageGet(VOICE_STORAGE_KEY);
    if (cachedVoice && voiceKey(cachedVoice) === wanted) return cachedVoice;
    return resolveVoice();
  }

  function setSelectedVoice(key) {
    selectedVoiceKey = String(key || '').trim();
    storageSet(VOICE_STORAGE_KEY, selectedVoiceKey);
    cachedVoice = null;
    enginePrimed = false;
    return resolveVoice();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.voice-listen-menu{min-width:270px;}',
      '.unbound-voice-picker{margin:5px 3px 7px;padding:9px;border:1px solid rgba(107,193,255,.22);border-radius:11px;background:rgba(66,165,255,.06);}',
      '.unbound-voice-picker label{display:block;margin-bottom:6px;color:#b9d9ef;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;}',
      '.unbound-voice-picker select{width:100%;min-height:38px;padding:7px 9px;border:1px solid rgba(107,193,255,.32);border-radius:9px;background:#08111f;color:#f7fbff;font:inherit;font-size:13px;}',
      '.unbound-voice-picker-note{margin:6px 1px 0;color:#8ea9bb;font-size:10px;line-height:1.35;}',
      '.voice-listen-action[data-auto-read="true"]{background:rgba(101,232,164,.13);color:#baf8d7;}',
      '@media (max-width:760px){.voice-listen-menu{min-width:240px;max-width:min(92vw,340px);}}'
    ].join('');
    document.head.appendChild(style);
  }

  function setNote(note, message, temporaryMs) {
    if (!note) return;
    if (noteTimer) {
      window.clearTimeout(noteTimer);
      noteTimer = null;
    }
    note.textContent = message || NORMAL_NOTE;
    if (temporaryMs) {
      noteTimer = window.setTimeout(() => {
        note.textContent = NORMAL_NOTE;
        noteTimer = null;
      }, temporaryMs);
    }
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\[Response interrupted before completion\.\]/gi, ' ')
      .replace(/https?:\/\/\S+/g, ' link ')
      .replace(/[*_#>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitText(value, limit = 560) {
    const text = cleanText(value);
    if (!text) return [];
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const chunks = [];
    let current = '';
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const combined = `${current} ${sentence}`.trim();
      if (combined.length <= limit) current = combined;
      else {
        if (current) chunks.push(current);
        current = sentence;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function stopBrowserSpeech() {
    speaking = false;
    priming = false;
    if (!('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }

  function primeSpeechEngine() {
    if (enginePrimed || priming || speaking || !('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return;
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) return;
    const voice = currentVoice();
    const warmup = new window.SpeechSynthesisUtterance('.');
    applyVoice(warmup, voice);
    warmup.rate = 10;
    warmup.pitch = 1;
    warmup.volume = 0;
    const finish = () => { priming = false; enginePrimed = true; };
    warmup.onstart = () => { enginePrimed = true; };
    warmup.onend = finish;
    warmup.onerror = () => { priming = false; };
    priming = true;
    try { synth.speak(warmup); } catch (_) { priming = false; }
  }

  function speakBrowser(text, onDone) {
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return false;
    const chunks = splitText(text);
    if (!chunks.length) return false;
    const synth = window.speechSynthesis;
    try { synth.cancel(); } catch (_) {}
    if (synth.paused) {
      try { synth.resume(); } catch (_) {}
    }
    const voice = currentVoice();
    speaking = true;
    let index = 0;

    function finish() {
      speaking = false;
      if (typeof onDone === 'function') onDone();
    }

    function next() {
      if (!speaking) return;
      if (index >= chunks.length) return finish();
      const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
      applyVoice(utterance, voice);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onstart = () => { enginePrimed = true; priming = false; };
      utterance.onend = () => { index += 1; window.setTimeout(next, 5); };
      utterance.onerror = finish;
      try { synth.speak(utterance); } catch (_) { finish(); }
    }

    next();
    return true;
  }

  function getLastAssistantText() {
    const selectors = ['[data-role="assistant"]', '.message.assistant', '.assistant-message', '.messages .assistant', '.messages .message'];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        const role = String(node.getAttribute('data-role') || '').toLowerCase();
        const className = String(node.className || '').toLowerCase();
        if (selector === '.messages .message' && !(role === 'assistant' || className.includes('assistant') || className.includes('ai'))) continue;
        const canonical = String(node.dataset?.speechText || '').trim();
        const text = canonical || String(node.innerText || node.textContent || '').trim();
        if (text) return text;
      }
    }
    return '';
  }

  function handsFreeActive() {
    return document.getElementById('unboundHandsFreeVoice')?.dataset.active === 'true';
  }

  function sendIsBusy() {
    const send = document.getElementById('sendButton') || document.querySelector('.send, button[type="submit"]');
    return Boolean(send && send.disabled);
  }

  async function hasAutoReadAccess() {
    try {
      const response = await window.fetch('/api/account/access', {
        method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return { allowed: false, message: response.status === 401 ? 'Sign in before enabling Auto-Read Replies.' : (payload.error || 'Could not verify Voice access.') };
      const voice = (payload?.access?.capabilities || []).find((item) => item?.key === 'voice');
      return { allowed: Boolean(voice?.usable), message: voice?.usable ? '' : 'Auto-Read Replies requires Premium or Ultra Voice access.' };
    } catch (_) {
      return { allowed: false, message: 'Could not verify Voice access right now.' };
    }
  }

  function updateAutoReadAction(action) {
    if (!action) return;
    action.dataset.autoRead = autoReadEnabled ? 'true' : 'false';
    action.setAttribute('aria-pressed', autoReadEnabled ? 'true' : 'false');
    action.textContent = autoReadEnabled ? '🔊 Auto-read new replies: ON' : '🔊 Auto-read new replies: OFF';
  }

  function scheduleAutoRead(note, delay = AUTO_READ_SETTLE_MS) {
    if (!autoReadEnabled) return;
    if (autoReadTimer) window.clearTimeout(autoReadTimer);
    autoReadTimer = window.setTimeout(() => {
      autoReadTimer = null;
      maybeAutoRead(note);
    }, delay);
  }

  function maybeAutoRead(note) {
    if (!autoReadEnabled || handsFreeActive()) return;
    if (sendIsBusy()) {
      autoReadSawBusy = true;
      scheduleAutoRead(note, 250);
      return;
    }
    if (!autoReadSawBusy) return;
    const text = getLastAssistantText();
    if (!text || text === autoReadLastText) {
      autoReadSawBusy = false;
      return;
    }
    autoReadSawBusy = false;
    autoReadLastText = text;
    if (/Response interrupted before completion/i.test(text)) return;
    const voice = currentVoice();
    setNote(note, voice ? `Auto-reading with device voice: ${voice.name} (${voice.lang || 'device'})` : 'Auto-reading with the device speech engine.', 4500);
    primeSpeechEngine();
    speakBrowser(text);
  }

  async function setAutoReadEnabled(enabled, action, note, persist = true) {
    if (!enabled) {
      autoReadEnabled = false;
      autoReadSawBusy = false;
      if (autoReadTimer) window.clearTimeout(autoReadTimer);
      autoReadTimer = null;
      if (persist) storageSet(AUTO_READ_STORAGE_KEY, 'false');
      updateAutoReadAction(action);
      setNote(note, 'Auto-read is off.', 3500);
      return false;
    }

    setNote(note, 'Checking Voice access…');
    const access = await hasAutoReadAccess();
    if (!access.allowed) {
      autoReadEnabled = false;
      if (persist) storageSet(AUTO_READ_STORAGE_KEY, 'false');
      updateAutoReadAction(action);
      setNote(note, access.message || 'Auto-read is unavailable.', 5000);
      return false;
    }

    autoReadEnabled = true;
    autoReadSawBusy = false;
    if (persist) storageSet(AUTO_READ_STORAGE_KEY, 'true');
    autoReadLastText = getLastAssistantText();
    updateAutoReadAction(action);
    primeSpeechEngine();
    const voice = currentVoice();
    setNote(note, voice ? `Auto-read is on with device voice: ${voice.name} (${voice.lang || 'device'})` : 'Auto-read is on with the device speech engine.', 5000);
    return true;
  }

  function startAutoReadObserver(note) {
    if (autoReadObserver || !document.body) return;
    autoReadObserver = new MutationObserver(() => scheduleAutoRead(note));
    autoReadObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled']
    });
  }

  function populateVoiceSelect(select) {
    const voices = systemVoices();
    const previous = selectedVoiceKey || storageGet(VOICE_STORAGE_KEY);
    select.replaceChildren();
    if (!voices.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Device default voice';
      select.appendChild(option);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    voices.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voiceKey(voice);
      option.textContent = `${voice.name}${voice.lang ? ` — ${voice.lang}` : ''}${voice.default ? ' — device default' : ''}`;
      select.appendChild(option);
    });
    const selected = findVoiceByKey(voices, previous)
      || voices.find((voice) => voice.default)
      || voices[0];
    setSelectedVoice(voiceKey(selected));
    select.value = selectedVoiceKey;
  }

  function closeVoiceMenu(button, menu) {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  function mount() {
    if (document.getElementById(SELECT_ID)) return true;
    const button = document.getElementById('unboundVoiceListenButton');
    if (!button) return false;
    const wrap = button.closest('.voice-listen-wrap');
    const menu = wrap?.querySelector('.voice-listen-menu');
    if (!menu) return false;

    injectStyles();
    selectedVoiceKey = storageGet(VOICE_STORAGE_KEY);
    resolveVoice();

    const actions = Array.from(menu.querySelectorAll('.voice-listen-action'));
    const listenAction = actions.find((item) => /Listen to last answer/i.test(String(item.textContent || ''))) || null;

    const picker = document.createElement('div');
    picker.className = 'unbound-voice-picker';
    const label = document.createElement('label');
    label.setAttribute('for', SELECT_ID);
    label.textContent = 'Device playback voice';
    const select = document.createElement('select');
    select.id = SELECT_ID;
    select.setAttribute('aria-label', 'Device playback voice');
    const note = document.createElement('div');
    note.className = 'unbound-voice-picker-note';
    note.textContent = NORMAL_NOTE;
    picker.append(label, select, note);
    populateVoiceSelect(select);

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'voice-listen-action';
    preview.textContent = '▶ Preview selected device voice';

    const autoReadAction = document.createElement('button');
    autoReadAction.type = 'button';
    autoReadAction.id = AUTO_READ_ACTION_ID;
    autoReadAction.className = 'voice-listen-action';
    autoReadAction.title = 'Automatically read completed replies with the selected device voice.';
    updateAutoReadAction(autoReadAction);

    if (listenAction) {
      menu.insertBefore(picker, listenAction);
      menu.insertBefore(preview, listenAction);
      menu.insertBefore(autoReadAction, listenAction);
    } else {
      menu.append(picker, preview, autoReadAction);
    }

    select.addEventListener('change', () => {
      stopBrowserSpeech();
      const voice = setSelectedVoice(select.value);
      select.value = selectedVoiceKey;
      setNote(note, voice ? `Playback voice: ${voice.name} (${voice.lang || 'device'})` : NORMAL_NOTE, 4500);
      primeSpeechEngine();
      window.dispatchEvent(new CustomEvent('unbound:device-voice-changed', { detail: { voiceKey: selectedVoiceKey } }));
    });

    button.addEventListener('pointerenter', primeSpeechEngine, { passive: true });
    button.addEventListener('pointerdown', primeSpeechEngine, { passive: true });
    button.addEventListener('focus', primeSpeechEngine, { passive: true });

    preview.addEventListener('pointerdown', (event) => {
      if (typeof event.button === 'number' && event.button !== 0) return;
      previewStartedOnPointerDown = true;
      speakBrowser('This is UNBOUND AI using your selected device voice.');
    });
    preview.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (previewStartedOnPointerDown) {
        previewStartedOnPointerDown = false;
        return;
      }
      speakBrowser('This is UNBOUND AI using your selected device voice.');
    });

    autoReadAction.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void setAutoReadEnabled(!autoReadEnabled, autoReadAction, note, true);
    });

    if (listenAction) {
      listenAction.addEventListener('click', (event) => {
        const text = getLastAssistantText();
        if (!text) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeVoiceMenu(button, menu);
        speakBrowser(text);
      }, true);
    }

    function refreshVoiceList() {
      cachedVoice = null;
      enginePrimed = false;
      populateVoiceSelect(select);
      window.setTimeout(primeSpeechEngine, 0);
    }

    if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', refreshVoiceList);
    }

    autoReadLastText = getLastAssistantText();
    startAutoReadObserver(note);
    if (storageGet(AUTO_READ_STORAGE_KEY) === 'true') void setAutoReadEnabled(true, autoReadAction, note, false);

    window.__unboundDeviceVoice = {
      storageKey: VOICE_STORAGE_KEY,
      getVoices: systemVoices,
      getVoice: currentVoice,
      setVoice: setSelectedVoice,
      speak: speakBrowser
    };

    window.setTimeout(primeSpeechEngine, 0);
    return true;
  }

  function boot() {
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.getVoices(); } catch (_) {}
    }
    if (mount()) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (mount() || attempts >= 40) window.clearInterval(timer);
    }, 125);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();