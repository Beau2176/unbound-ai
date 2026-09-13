(() => {
  const STYLE_ID = 'unbound-voice-presets-v108';
  const SELECT_ID = 'unboundVoicePreset';
  const STORAGE_KEY = 'unbound.voice.preset';
  const PREVIEW_TEXT = 'Voice 2 — Clear. This is UNBOUND AI.';
  const PRESET = {
    id: 'clear',
    label: 'Voice 2 — Clear',
    rate: 1.0,
    pitch: 1.0,
    preferred: ['Google US English', 'Sonia', 'Serena', 'Libby', 'Hazel', 'Susan']
  };

  let speaking = false;
  let cachedVoice = null;
  let priming = false;
  let enginePrimed = false;
  let previewStartedOnPointerDown = false;

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
    for (const preferred of PRESET.preferred) {
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
    warmup.pitch = PRESET.pitch;
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

  function stopSpeaking() {
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

  function speak(text, onDone) {
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return false;
    const chunks = splitText(text, 560);
    if (!chunks.length) return false;

    const synth = window.speechSynthesis;
    const realSpeechActive = speaking || ((synth.speaking || synth.pending) && !priming);
    if (realSpeechActive) stopSpeaking();
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
      utterance.rate = PRESET.rate;
      utterance.pitch = PRESET.pitch;
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
    try { window.localStorage.setItem(STORAGE_KEY, PRESET.id); } catch (_) {}
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
    const option = document.createElement('option');
    option.value = PRESET.id;
    option.textContent = PRESET.label;
    select.appendChild(option);
    const note = document.createElement('div');
    note.className = 'unbound-voice-picker-note';
    note.textContent = 'Voice 2 — Clear is the active reliable voice while the other temporary voices are being replaced.';
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

    button.addEventListener('pointerenter', primeSpeechEngine, { passive: true });
    button.addEventListener('pointerdown', primeSpeechEngine, { passive: true });
    button.addEventListener('focus', primeSpeechEngine, { passive: true });

    preview.addEventListener('pointerdown', (event) => {
      if (typeof event.button === 'number' && event.button !== 0) return;
      previewStartedOnPointerDown = true;
      speak(PREVIEW_TEXT);
    });

    preview.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (previewStartedOnPointerDown) {
        previewStartedOnPointerDown = false;
        return;
      }
      speak(PREVIEW_TEXT);
    });

    if (listenAction) {
      listenAction.addEventListener('click', (event) => {
        const text = getLastAssistantText();
        if (!text) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeVoiceMenu(button, menu);
        speak(text);
      }, true);
    }

    function refreshTitle() {
      const voice = refreshVoiceCache();
      enginePrimed = false;
      select.title = voice ? 'Using ' + voice.name : 'Using browser default voice';
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
