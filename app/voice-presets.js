(() => {
  const STYLE_ID = 'unbound-voice-presets-v105';
  const SELECT_ID = 'unboundVoicePreset';
  const STORAGE_KEY = 'unbound.voice.preset';
  const DEFAULT_PRESET = 'clear';
  const CLOUD_ENDPOINT = '/api/voice/natural-speech';

  const PRESETS = [
    { id: 'warm', label: 'Voice 1 — Warm', provider: 'cloud' },
    {
      id: 'clear',
      label: 'Voice 2 — Clear',
      provider: 'browser',
      rate: 1.00,
      pitch: 1.00,
      preferred: ['Google US English', 'Sonia', 'Serena', 'Libby', 'Hazel', 'Susan']
    },
    { id: 'deep', label: 'Voice 3 — Deep', provider: 'cloud' },
    { id: 'bright', label: 'Voice 4 — Bright', provider: 'cloud' },
    { id: 'calm', label: 'Voice 5 — Calm', provider: 'cloud' }
  ];

  let speaking = false;
  let activeAudio = null;
  let activeObjectUrl = '';
  let playbackToken = 0;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.voice-listen-menu{min-width:260px;}',
      '.unbound-voice-picker{margin:5px 3px 7px;padding:9px;border:1px solid rgba(107,193,255,.22);border-radius:11px;background:rgba(66,165,255,.06);}',
      '.unbound-voice-picker label{display:block;margin-bottom:6px;color:#b9d9ef;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;}',
      '.unbound-voice-picker select{width:100%;min-height:38px;padding:7px 9px;border:1px solid rgba(107,193,255,.32);border-radius:9px;background:#08111f;color:#f7fbff;font:inherit;font-size:13px;}',
      '.unbound-voice-picker-note{margin:6px 1px 0;color:#8ea9bb;font-size:10px;line-height:1.35;}',
      '@media (max-width:760px){.voice-listen-menu{min-width:235px;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function readPresetId() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (PRESETS.some((preset) => preset.id === saved)) return saved;
    } catch (_) {}
    return DEFAULT_PRESET;
  }

  function savePresetId(id) {
    if (!PRESETS.some((preset) => preset.id === id)) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch (_) {}
  }

  function selectedPreset() {
    const id = readPresetId();
    return PRESETS.find((preset) => preset.id === id) || PRESETS[1];
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

  function resolveClearVoice() {
    const preset = PRESETS[1];
    const voices = englishVoices();
    if (!voices.length) return null;

    for (const preferred of preset.preferred) {
      const wanted = preferred.toLowerCase();
      const match = voices.find((voice) => String(voice.name || '').toLowerCase().includes(wanted));
      if (match) return match;
    }

    return voices[0] || null;
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
    const maxLength = limit || 2800;
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const chunks = [];
    let current = '';

    function pushLongSentence(sentence) {
      let remaining = sentence;
      while (remaining.length > maxLength) {
        let cut = remaining.lastIndexOf(' ', maxLength);
        if (cut < Math.floor(maxLength * 0.6)) cut = maxLength;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
      return remaining;
    }

    for (const raw of sentences) {
      let sentence = raw.trim();
      if (!sentence) continue;
      const combined = (current + ' ' + sentence).trim();
      if (combined.length <= maxLength) {
        current = combined;
        continue;
      }
      if (current) chunks.push(current);
      current = '';
      if (sentence.length > maxLength) sentence = pushLongSentence(sentence);
      current = sentence;
    }

    if (current) chunks.push(current);
    return chunks.filter(Boolean);
  }

  function cleanupObjectUrl() {
    if (activeObjectUrl) {
      try { URL.revokeObjectURL(activeObjectUrl); } catch (_) {}
      activeObjectUrl = '';
    }
  }

  function stopPlayback() {
    playbackToken += 1;
    speaking = false;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.removeAttribute('src');
      } catch (_) {}
      activeAudio = null;
    }
    cleanupObjectUrl();
  }

  function speakClear(text, onDone) {
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return false;
    const chunks = splitText(text, 560);
    if (!chunks.length) return false;

    stopPlayback();
    const token = playbackToken;
    speaking = true;
    const voice = resolveClearVoice();
    let index = 0;

    function finish() {
      if (token !== playbackToken) return;
      speaking = false;
      if (typeof onDone === 'function') onDone();
    }

    function next() {
      if (!speaking || token !== playbackToken) return;
      if (index >= chunks.length) {
        finish();
        return;
      }

      const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
      if (voice) utterance.voice = voice;
      utterance.lang = (voice && voice.lang) || 'en-US';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1;
      utterance.onend = () => {
        index += 1;
        window.setTimeout(next, 35);
      };
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    }

    next();
    return true;
  }

  async function fetchCloudAudio(text, presetId) {
    const response = await fetch(CLOUD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ text, preset: presetId })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Natural cloud voice is unavailable.');
    }

    return response.blob();
  }

  function playBlob(blob, token) {
    return new Promise((resolve, reject) => {
      if (token !== playbackToken) {
        resolve();
        return;
      }

      cleanupObjectUrl();
      activeObjectUrl = URL.createObjectURL(blob);
      activeAudio = new Audio(activeObjectUrl);
      activeAudio.onended = () => {
        activeAudio = null;
        cleanupObjectUrl();
        resolve();
      };
      activeAudio.onerror = () => {
        activeAudio = null;
        cleanupObjectUrl();
        reject(new Error('Natural voice audio could not be played.'));
      };
      activeAudio.play().catch(reject);
    });
  }

  async function speakCloud(text, preset, onDone) {
    const chunks = splitText(text, 2800);
    if (!chunks.length) return false;

    stopPlayback();
    const token = playbackToken;
    speaking = true;

    try {
      for (const chunk of chunks) {
        if (token !== playbackToken) return true;
        const blob = await fetchCloudAudio(chunk, preset.id);
        if (token !== playbackToken) return true;
        await playBlob(blob, token);
      }
      if (token === playbackToken) {
        speaking = false;
        if (typeof onDone === 'function') onDone();
      }
      return true;
    } catch (error) {
      if (token === playbackToken) speaking = false;
      throw error;
    }
  }

  async function speakSelected(text, onDone) {
    const preset = selectedPreset();
    if (preset.provider === 'browser') {
      return speakClear(text, onDone);
    }

    try {
      await speakCloud(text, preset, onDone);
      return true;
    } catch (error) {
      const fallbackStarted = speakClear(text, onDone);
      if (fallbackStarted) {
        const select = document.getElementById(SELECT_ID);
        if (select) select.title = 'Cloud voice unavailable; temporarily using Voice 2 — Clear.';
      }
      return fallbackStarted;
    }
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
    select.value = readPresetId();

    const note = document.createElement('div');
    note.className = 'unbound-voice-picker-note';
    note.textContent = 'Voice 2 stays on your clear device voice. Voices 1, 3, 4, and 5 use distinct AI-generated natural cloud voices. Your choice is saved.';

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

    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('change', () => {
      savePresetId(select.value);
      stopPlayback();
      const preset = selectedPreset();
      select.title = preset.provider === 'browser' ? 'Using the clear natural voice on this device.' : 'Using a distinct natural cloud voice.';
    });

    preview.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const preset = selectedPreset();
      preview.disabled = true;
      void speakSelected(preset.label + '. This is how UNBOUND AI will sound when it reads an answer aloud.', () => {
        preview.disabled = false;
      }).finally(() => {
        if (!speaking) preview.disabled = false;
      });
    });

    if (listenAction) {
      listenAction.addEventListener('click', (event) => {
        const text = getLastAssistantText();
        if (!text) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeVoiceMenu(button, menu);
        void speakSelected(text);
      }, true);
    }

    function refreshClearVoiceTitle() {
      if (selectedPreset().provider !== 'browser') return;
      const voice = resolveClearVoice();
      select.title = voice ? 'Using ' + voice.name : 'Using browser default voice';
    }

    refreshClearVoiceTitle();
    if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', refreshClearVoiceTitle);
    }

    return true;
  }

  function boot() {
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
