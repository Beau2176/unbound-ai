(() => {
  const STYLE_ID = 'unbound-voice-presets-v109';
  const SELECT_ID = 'unboundVoicePreset';
  const STORAGE_KEY = 'unbound.voice.preset';
  const CLOUD_SPEECH_URL = '/api/voice/natural-speech';
  const DEFAULT_PRESET_ID = 'clear';
  const CLEAR_PRESET = {
    id: 'clear',
    label: 'Voice 2 — Clear',
    provider: 'browser',
    rate: 1.0,
    pitch: 1.0,
    preferred: ['Google US English', 'Sonia', 'Serena', 'Libby', 'Hazel', 'Susan']
  };
  const PRESETS = [
    { id: 'marin', label: 'Voice 1 — Marin', provider: 'openai' },
    CLEAR_PRESET,
    { id: 'cedar', label: 'Voice 3 — Cedar', provider: 'openai' },
    { id: 'coral', label: 'Voice 4 — Coral', provider: 'openai' },
    { id: 'nova', label: 'Voice 5 — Nova', provider: 'openai' }
  ];
  const NORMAL_NOTE = 'Voice 2 — Clear stays local and instant. Marin, Cedar, Coral, and Nova use OpenAI speech and fall back to Voice 2 if cloud speech is unavailable.';

  let speaking = false;
  let cachedVoice = null;
  let priming = false;
  let enginePrimed = false;
  let previewStartedOnPointerDown = false;
  let selectedPresetId = DEFAULT_PRESET_ID;
  let activeAudio = null;
  let activeAudioUrl = '';
  let playbackSerial = 0;
  let noteTimer = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.voice-listen-menu{min-width:250px;}',
      '.unbound-voice-picker{margin:5px 3px 7px;padding:9px;border:1px solid rgba(107,193,255,.22);border-radius:11px;background:rgba(66,165,255,.06);}',
      '.unbound-voice-picker label{display:block;margin-bottom:6px;color:#b9d9ef;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;}',
      '.unbound-voice-picker select{width:100%;min-height:38px;padding:7px 9px;border:1px solid rgba(107,193,255,.32);border-radius:9px;background:#08111f;color:#f7fbff;font:inherit;font-size:13px;}',
      '.unbound-voice-picker-note{margin:6px 1px 0;color:#8ea9bb;font-size:10px;line-height:1.35;}',
      '@media (max-width:760px){.voice-listen-menu{min-width:230px;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function presetById(id) {
    return PRESETS.find((preset) => preset.id === id) || CLEAR_PRESET;
  }

  function loadSavedPreset() {
    try {
      const saved = String(window.localStorage.getItem(STORAGE_KEY) || '').trim().toLowerCase();
      if (PRESETS.some((preset) => preset.id === saved)) return saved;
    } catch (_) {}
    return DEFAULT_PRESET_ID;
  }

  function savePreset(id) {
    selectedPresetId = presetById(id).id;
    try { window.localStorage.setItem(STORAGE_KEY, selectedPresetId); } catch (_) {}
  }

  function voiceScore(voice) {
    const name = String((voice && voice.name) || '');
    const lang = String((voice && voice.lang) || '');
    let score = 0;
    if (/natural/i.test(name)) score += 500;
    if (/neural/i.test(name)) score += 450;
    if (/online/i.test(name)) score += 300;
    if (/google/i.test(name)) score += 250;
    if (/microsoft/i.test(name)) score += 180;
    if (/enhanced|premium/i.test(name)) score += 160;
    if (/^en(?:-|$)/i.test(lang)) score += 80;
    if (voice && voice.default) score += 25;
    return score;
  }

  function englishVoices() {
    if (!('speechSynthesis' in window)) return [];
    const all = window.speechSynthesis.getVoices() || [];
    const english = all.filter((voice) => /^en(?:-|$)/i.test(String(voice.lang || '')));
    return (english.length ? english : all).slice().sort((a, b) => voiceScore(b) - voiceScore(a));
  }

  function refreshVoiceCache() {
    const voices = englishVoices();
    if (!voices.length) {
      cachedVoice = null;
      return null;
    }
    for (const preferred of CLEAR_PRESET.preferred) {
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

  function resolveVoice() {
    return cachedVoice || refreshVoiceCache();
  }

  function primeVoiceList() {
    if (!('speechSynthesis' in window)) return;
    try { window.speechSynthesis.getVoices(); } catch (_) {}
    refreshVoiceCache();
  }

  function primeSpeechEngine() {
    if (
      enginePrimed ||
      priming ||
      speaking ||
      !('speechSynthesis' in window) ||
      typeof window.SpeechSynthesisUtterance !== 'function'
    ) return;

    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) return;

    primeVoiceList();
    const voice = resolveVoice();
    const warmup = new window.SpeechSynthesisUtterance('.');
    if (voice) warmup.voice = voice;
    warmup.lang = (voice && voice.lang) || 'en-US';
    warmup.rate = 10;
    warmup.pitch = CLEAR_PRESET.pitch;
    warmup.volume = 0;

    const finishPrime = () => {
      priming = false;
      enginePrimed = true;
    };
    warmup.onstart = () => { enginePrimed = true; };
    warmup.onend = finishPrime;
    warmup.onerror = () => { priming = false; };

    priming = true;
    try {
      synth.speak(warmup);
    } catch (_) {
      priming = false;
    }
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/https?:\/\/\S+/g, ' link ')
      .replace(/[*_#>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitText(value, limit) {
    const text = cleanText(value);
    if (!text) return [];
    const maxLength = limit || 560;
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const chunks = [];
    let current = '';
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const combined = (current + ' ' + sentence).trim();
      if (combined.length <= maxLength) {
        current = combined;
        continue;
      }
      if (current) chunks.push(current);
      current = sentence;
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function stopBrowserSpeech() {
    if (!('speechSynthesis' in window)) {
      speaking = false;
      priming = false;
      return;
    }
    const synth = window.speechSynthesis;
    const hasActiveSpeech = speaking || synth.speaking || synth.pending;
    speaking = false;
    priming = false;
    if (hasActiveSpeech) synth.cancel();
  }

  function stopCloudAudio() {
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      } catch (_) {}
      activeAudio = null;
    }
    if (activeAudioUrl) {
      try { URL.revokeObjectURL(activeAudioUrl); } catch (_) {}
      activeAudioUrl = '';
    }
  }

  function stopAllPlayback() {
    playbackSerial += 1;
    stopCloudAudio();
    stopBrowserSpeech();
  }

  function speakBrowser(text, onDone) {
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return false;
    const chunks = splitText(text, 560);
    if (!chunks.length) return false;

    const synth = window.speechSynthesis;
    const realSpeechActive = speaking || ((synth.speaking || synth.pending) && !priming);
    if (realSpeechActive) stopBrowserSpeech();
    if (synth.paused) {
      try { synth.resume(); } catch (_) {}
    }

    speaking = true;
    const voice = resolveVoice();
    let index = 0;

    function finish() {
      speaking = false;
      if (typeof onDone === 'function') onDone();
    }

    function next() {
      if (!speaking) return;
      if (index >= chunks.length) return finish();
      const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
      if (voice) utterance.voice = voice;
      utterance.lang = (voice && voice.lang) || 'en-US';
      utterance.rate = CLEAR_PRESET.rate;
      utterance.pitch = CLEAR_PRESET.pitch;
      utterance.volume = 1;
      utterance.onstart = () => {
        enginePrimed = true;
        priming = false;
      };
      utterance.onend = () => {
        index += 1;
        window.setTimeout(next, 5);
      };
      utterance.onerror = finish;
      synth.speak(utterance);
    }

    next();
    return true;
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

  async function speakOpenAi(text, preset, token, note, onDone) {
    const input = cleanText(text).slice(0, 4096);
    if (!input) return false;

    try {
      const response = await window.fetch(CLOUD_SPEECH_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input, preset: preset.id })
      });

      if (token !== playbackSerial) return false;
      if (!response.ok) {
        const error = new Error('OpenAI speech request failed.');
        error.status = response.status;
        throw error;
      }

      const blob = await response.blob();
      if (token !== playbackSerial) return false;
      if (!blob || !blob.size) throw new Error('OpenAI speech returned no audio.');

      stopCloudAudio();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudio = audio;
      activeAudioUrl = url;
      audio.onended = () => {
        if (activeAudio === audio) stopCloudAudio();
        if (typeof onDone === 'function') onDone();
      };
      audio.onerror = () => {
        if (activeAudio === audio) stopCloudAudio();
      };
      await audio.play();
      return true;
    } catch (error) {
      if (token !== playbackSerial) return false;
      const reason = error && error.status === 429 ? 'OpenAI voice limit reached' : 'OpenAI voice unavailable';
      setNote(note, reason + ' — playing Voice 2 — Clear instead.', 5000);
      primeSpeechEngine();
      return speakBrowser(text, onDone);
    }
  }

  function speakSelected(text, note, onDone) {
    const preset = presetById(selectedPresetId);
    playbackSerial += 1;
    const token = playbackSerial;
    stopCloudAudio();
    stopBrowserSpeech();

    if (preset.provider === 'browser') {
      setNote(note, NORMAL_NOTE);
      return speakBrowser(text, onDone);
    }

    setNote(note, 'Loading ' + preset.label.replace(/^Voice \d+ — /, '') + ' from OpenAI…');
    void speakOpenAi(text, preset, token, note, onDone);
    return true;
  }

  function previewText() {
    const preset = presetById(selectedPresetId);
    if (preset.id === 'clear') return 'Voice 2 — Clear. This is UNBOUND AI.';
    return preset.label.replace(/^Voice \d+ — /, '') + '. This is UNBOUND AI.';
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
        const text = String(node.innerText || node.textContent || '').trim();
        if (text) return text;
      }
    }
    return '';
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
    if (!wrap) return false;
    const menu = wrap.querySelector('.voice-listen-menu');
    if (!menu) return false;

    injectStyles();
    selectedPresetId = loadSavedPreset();
    savePreset(selectedPresetId);
    primeVoiceList();

    const actions = Array.from(menu.querySelectorAll('.voice-listen-action'));
    const listenAction = actions.find((item) => String(item.textContent || '').includes('Listen to last answer')) || null;

    const picker = document.createElement('div');
    picker.className = 'unbound-voice-picker';
    const label = document.createElement('label');
    label.setAttribute('for', SELECT_ID);
    label.textContent = 'Spoken answer voice';
    const select = document.createElement('select');
    select.id = SELECT_ID;
    select.setAttribute('aria-label', 'Spoken answer voice');
    for (const preset of PRESETS) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      select.appendChild(option);
    }
    select.value = selectedPresetId;
    const note = document.createElement('div');
    note.className = 'unbound-voice-picker-note';
    note.textContent = NORMAL_NOTE;
    picker.append(label, select, note);

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'voice-listen-action';
    preview.textContent = '▶ Preview selected voice';

    if (listenAction) {
      menu.insertBefore(picker, listenAction);
      menu.insertBefore(preview, listenAction);
    } else {
      menu.append(picker, preview);
    }

    select.addEventListener('change', () => {
      stopAllPlayback();
      savePreset(select.value);
      select.value = selectedPresetId;
      setNote(note, NORMAL_NOTE);
      primeSpeechEngine();
    });

    button.addEventListener('pointerenter', primeSpeechEngine, { passive: true });
    button.addEventListener('pointerdown', primeSpeechEngine, { passive: true });
    button.addEventListener('focus', primeSpeechEngine, { passive: true });

    preview.addEventListener('pointerdown', (event) => {
      if (typeof event.button === 'number' && event.button !== 0) return;
      previewStartedOnPointerDown = true;
      speakSelected(previewText(), note);
    });

    preview.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (previewStartedOnPointerDown) {
        previewStartedOnPointerDown = false;
        return;
      }
      speakSelected(previewText(), note);
    });

    if (listenAction) {
      listenAction.addEventListener('click', (event) => {
        const text = getLastAssistantText();
        if (!text) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeVoiceMenu(button, menu);
        speakSelected(text, note);
      }, true);
    }

    function refreshTitle() {
      const voice = refreshVoiceCache();
      enginePrimed = false;
      const preset = presetById(selectedPresetId);
      select.title = preset.provider === 'browser'
        ? (voice ? 'Using ' + voice.name : 'Using browser default voice')
        : 'Using OpenAI ' + preset.label.replace(/^Voice \d+ — /, '');
      window.setTimeout(primeSpeechEngine, 0);
    }
    refreshTitle();
    if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', refreshTitle);
    }

    window.setTimeout(primeSpeechEngine, 0);
    return true;
  }

  function boot() {
    primeVoiceList();
    if (mount()) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (mount() || attempts >= 40) window.clearInterval(timer);
    }, 125);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
