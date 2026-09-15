(() => {
  'use strict';

  const VERSION = 'unbound-mobile-voice-fast-path-v1';
  const AUTO_READ_STORAGE_KEY = 'unbound.voice.autoRead.safe.v2';
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
  let generation = 0;
  let queue = [];
  let buffer = '';

  function autoReadEnabled() {
    try { return window.localStorage.getItem(AUTO_READ_STORAGE_KEY) === 'true'; }
    catch (_) { return false; }
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
    if (/^en-US$/i.test(lang)) score += 300;
    else if (/^en(?:-|$)/i.test(lang)) score += 180;
    if (/google/i.test(name)) score += 120;
    if (/natural|neural|enhanced|premium/i.test(name)) score += 80;
    if (voice?.default) score += 20;
    return score;
  }

  function resolveVoice() {
    if (cachedVoice) return cachedVoice;
    if (!('speechSynthesis' in window)) return null;
    const all = window.speechSynthesis.getVoices() || [];
    const english = all.filter((voice) => /^en(?:-|$)/i.test(String(voice.lang || '')));
    const voices = (english.length ? english : all).slice().sort((a, b) => voiceScore(b) - voiceScore(a));
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
    warmup.lang = voice?.lang || 'en-US';
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
        for (let offset = 0; offset < word.length; offset += MAX_CHUNK) {
          chunks.push(word.slice(offset, offset + MAX_CHUNK));
        }
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

  function speakNext() {
    if (speaking || !queue.length || !autoReadEnabled() || handsFreeActive()) return;
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return;
    const token = generation;
    const text = queue.shift();
    const voice = resolveVoice();
    const utterance = new window.SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    speaking = true;
    utterance.onstart = () => { primed = true; priming = false; };
    utterance.onend = () => {
      if (token !== generation) return;
      speaking = false;
      window.setTimeout(speakNext, 15);
    };
    utterance.onerror = () => { speaking = false; };
    try { window.speechSynthesis.speak(utterance); } catch (_) { speaking = false; }
  }

  function enqueue(text) {
    const chunks = split(text);
    if (!chunks.length) return;
    queue.push(...chunks);
    speakNext();
  }

  function reset() {
    generation += 1;
    queue = [];
    buffer = '';
    speaking = false;
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
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
    if (typeof detail.delta === 'string' && detail.delta) buffer += detail.delta;
    if (detail.done && typeof detail.text === 'string' && !buffer) buffer = detail.text;
    drain(Boolean(detail.done));
  }

  document.addEventListener('pointerdown', prime, { passive: true, capture: true, once: true });
  document.addEventListener('touchstart', prime, { passive: true, capture: true, once: true });
  window.addEventListener('unbound:assistant-stream', onStream);
  if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      cachedVoice = null;
      resolveVoice();
    });
  }

  window.__unboundMobileVoiceFastPath = { version: VERSION, prime, reset, isMobile: true };
})();
