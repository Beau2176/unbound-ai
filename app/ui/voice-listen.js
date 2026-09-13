const VOICE_LISTEN_STYLE_ID = "unbound-voice-listen-v103";
const VOICE_LISTEN_SCRIPT_ID = "unbound-voice-listen-v103";

const VOICE_LISTEN_STYLES = `<style id="${VOICE_LISTEN_STYLE_ID}">
.voice-listen-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
}
.voice-listen-button {
  min-height: 46px;
  padding: 0 14px;
  border: 1px solid rgba(107,193,255,.46);
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(66,165,255,.18), rgba(255,173,67,.12));
  color: #f7fbff;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}
.voice-listen-button:hover { border-color: rgba(255,173,67,.64); }
.voice-listen-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 120;
  min-width: 250px;
  padding: 8px;
  border: 1px solid rgba(107,193,255,.35);
  border-radius: 14px;
  background: rgba(3,8,16,.97);
  box-shadow: 0 18px 45px rgba(0,0,0,.45);
}
.voice-listen-menu[hidden] { display: none !important; }
.voice-listen-action {
  width: 100%;
  min-height: 42px;
  padding: 9px 11px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #f7fbff;
  text-align: left;
  cursor: pointer;
  font-weight: 750;
}
.voice-listen-action:hover { background: rgba(66,165,255,.14); }
.voice-picker {
  margin: 5px 3px 7px;
  padding: 9px;
  border: 1px solid rgba(107,193,255,.22);
  border-radius: 11px;
  background: rgba(66,165,255,.06);
}
.voice-picker-label {
  display: block;
  margin-bottom: 6px;
  color: #b9d9ef;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.voice-picker-select {
  width: 100%;
  min-height: 38px;
  padding: 7px 9px;
  border: 1px solid rgba(107,193,255,.32);
  border-radius: 9px;
  background: #08111f;
  color: #f7fbff;
  font: inherit;
  font-size: 13px;
}
.voice-picker-note {
  margin: 6px 1px 0;
  color: #8ea9bb;
  font-size: 10px;
  line-height: 1.35;
}
.voice-listen-button[data-listening="true"] {
  border-color: rgba(255,118,118,.75);
  box-shadow: 0 0 0 3px rgba(255,118,118,.12);
}
@media (max-width: 760px) {
  .voice-listen-button { min-height: 46px; padding: 0 10px; font-size: 12px; }
  .voice-listen-menu { min-width: 230px; }
}
@media (max-width: 430px) {
  .voice-listen-button { width: 46px; padding: 0; font-size: 0; }
  .voice-listen-button::before { content: "🎙"; font-size: 20px; }
}
</style>`;

const VOICE_LISTEN_SCRIPT = `<script id="${VOICE_LISTEN_SCRIPT_ID}">
(() => {
  let audio = null;
  let recognition = null;
  let speaking = false;

  const VOICE_PRESETS = [
    {
      id: 'warm',
      label: 'Voice 1 — Warm',
      rate: 0.96,
      pitch: 1.02,
      preferred: ['Aria', 'Jenny', 'Samantha', 'Zira', 'Ava', 'Emma', 'Google US English']
    },
    {
      id: 'clear',
      label: 'Voice 2 — Clear',
      rate: 0.98,
      pitch: 1.00,
      preferred: ['Sonia', 'Hazel', 'Susan', 'Serena', 'Libby', 'Google UK English Female']
    },
    {
      id: 'deep',
      label: 'Voice 3 — Deep',
      rate: 0.93,
      pitch: 0.88,
      preferred: ['Guy', 'Ryan', 'Brian', 'Daniel', 'David', 'Mark', 'George']
    },
    {
      id: 'bright',
      label: 'Voice 4 — Bright',
      rate: 1.00,
      pitch: 1.08,
      preferred: ['Michelle', 'Ana', 'Salli', 'Victoria', 'Karen', 'Tessa']
    },
    {
      id: 'calm',
      label: 'Voice 5 — Calm',
      rate: 0.90,
      pitch: 0.96,
      preferred: ['Andrew', 'Christopher', 'Eric', 'James', 'Oliver', 'Alex']
    }
  ];

  const VOICE_STORAGE_KEY = 'unbound.voice.preset';

  function getComposerTextarea() {
    return document.querySelector('#message, .composer textarea, textarea[name="message"], textarea');
  }

  function submitComposer(textarea) {
    if (!textarea) return false;
    const form = textarea.closest('form') || document.getElementById('chatForm');
    const sendButton = document.getElementById('sendButton') || form?.querySelector('.send, button[type="submit"]');

    if (sendButton && !sendButton.disabled) {
      sendButton.click();
      return true;
    }

    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return true;
    }

    if (form) {
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: sendButton || null }));
      return true;
    }

    return false;
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
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const node = nodes[i];
        const role = (node.getAttribute('data-role') || '').toLowerCase();
        const className = String(node.className || '').toLowerCase();
        if (selector === '.messages .message' && !(role === 'assistant' || className.includes('assistant') || className.includes('ai'))) continue;
        const text = (node.innerText || node.textContent || '').trim();
        if (text) return text;
      }
    }
    return '';
  }

  function getSelectedPresetId() {
    try {
      const saved = window.localStorage.getItem(VOICE_STORAGE_KEY);
      if (VOICE_PRESETS.some((preset) => preset.id === saved)) return saved;
    } catch (_) {}
    return VOICE_PRESETS[0].id;
  }

  function getSelectedPreset() {
    const id = getSelectedPresetId();
    return VOICE_PRESETS.find((preset) => preset.id === id) || VOICE_PRESETS[0];
  }

  function saveSelectedPreset(id) {
    if (!VOICE_PRESETS.some((preset) => preset.id === id)) return;
    try { window.localStorage.setItem(VOICE_STORAGE_KEY, id); } catch (_) {}
  }

  function voiceQualityScore(voice) {
    const name = String(voice?.name || '');
    let score = 0;
    if (/natural/i.test(name)) score += 120;
    if (/neural/i.test(name)) score += 110;
    if (/online/i.test(name)) score += 80;
    if (/google/i.test(name)) score += 65;
    if (/microsoft/i.test(name)) score += 45;
    if (/english|en-us|en-gb/i.test(name + ' ' + String(voice?.lang || ''))) score += 20;
    if (voice?.default) score += 8;
    return score;
  }

  function availableEnglishVoices() {
    if (!('speechSynthesis' in window)) return [];
    const all = window.speechSynthesis.getVoices() || [];
    const english = all.filter((voice) => /^en(?:-|$)/i.test(String(voice.lang || '')));
    return (english.length ? english : all).slice().sort((a, b) => voiceQualityScore(b) - voiceQualityScore(a));
  }

  function resolveVoiceForPreset(preset) {
    const voices = availableEnglishVoices();
    if (!voices.length) return null;

    for (const preferredName of preset.preferred) {
      const match = voices.find((voice) => String(voice.name || '').toLowerCase().includes(preferredName.toLowerCase()));
      if (match) return match;
    }

    const presetIndex = Math.max(0, VOICE_PRESETS.findIndex((item) => item.id === preset.id));
    return voices[presetIndex % voices.length] || voices[0];
  }

  function cleanSpeechText(value) {
    return String(value || '')
      .replace(/```[\\s\\S]*?```/g, ' code example omitted ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/https?:\\/\\/\\S+/g, ' link ')
      .replace(/[*_#>|]/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function splitSpeechText(text, maxLength = 240) {
    const cleaned = cleanSpeechText(text);
    if (!cleaned) return [];
    const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
    const chunks = [];
    let current = '';

    for (const rawSentence of sentences) {
      const sentence = rawSentence.trim();
      if (!sentence) continue;
      if ((current + ' ' + sentence).trim().length <= maxLength) {
        current = (current + ' ' + sentence).trim();
        continue;
      }
      if (current) chunks.push(current);
      if (sentence.length <= maxLength) {
        current = sentence;
        continue;
      }
      const words = sentence.split(/\\s+/);
      current = '';
      for (const word of words) {
        if ((current + ' ' + word).trim().length > maxLength && current) {
          chunks.push(current);
          current = word;
        } else {
          current = (current + ' ' + word).trim();
        }
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function stopBrowserSpeech() {
    if (!('speechSynthesis' in window)) return;
    speaking = false;
    window.speechSynthesis.cancel();
  }

  function speakWithSelectedBrowserVoice(text, onDone = null) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') return false;
    const chunks = splitSpeechText(text);
    if (!chunks.length) return false;

    stopBrowserSpeech();
    speaking = true;
    const preset = getSelectedPreset();
    const voice = resolveVoiceForPreset(preset);
    let index = 0;

    const speakNext = () => {
      if (!speaking) return;
      if (index >= chunks.length) {
        speaking = false;
        if (typeof onDone === 'function') onDone();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'en-US';
      utterance.rate = preset.rate;
      utterance.pitch = preset.pitch;
      utterance.volume = 1;
      utterance.onend = () => {
        index += 1;
        window.setTimeout(speakNext, 45);
      };
      utterance.onerror = () => {
        speaking = false;
        if (typeof onDone === 'function') onDone();
      };
      window.speechSynthesis.speak(utterance);
    };

    speakNext();
    return true;
  }

  async function tryHeyGenVoice(text) {
    try {
      const response = await fetch('/api/voice/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.audioUrl) return false;
      if (audio) {
        try { audio.pause(); } catch (_) {}
      }
      audio = new Audio(payload.audioUrl);
      await audio.play();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function listenToLastAnswer(button) {
    const text = getLastAssistantText();
    if (!text) {
      button.title = 'No UNBOUND AI answer is available to read yet.';
      return;
    }

    button.disabled = true;
    try {
      if (speakWithSelectedBrowserVoice(text, () => { button.disabled = false; })) {
        button.title = getSelectedPreset().label + ' is reading the latest answer.';
        return;
      }

      const played = await tryHeyGenVoice(text);
      if (!played) button.title = 'Voice playback is unavailable on this browser.';
    } finally {
      if (!speaking) button.disabled = false;
    }
  }

  function previewSelectedVoice(button) {
    const preset = getSelectedPreset();
    const sample = preset.label + '. This is how I will sound when UNBOUND AI reads an answer aloud.';
    const started = speakWithSelectedBrowserVoice(sample);
    button.title = started ? 'Previewing ' + preset.label : 'Browser voice preview is unavailable.';
  }

  function startVoiceInput(button) {
    const textarea = getComposerTextarea();
    if (!textarea) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      textarea.focus();
      button.title = 'Voice input is not supported by this browser. You can still type your message.';
      return;
    }

    if (recognition) {
      try { recognition.stop(); } catch (_) {}
      return;
    }

    recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    const original = textarea.value.trim();
    let latestTranscript = '';
    let recognizedSpeech = false;
    let recognitionFailed = false;

    button.dataset.listening = 'true';
    button.textContent = '● Listening…';

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      latestTranscript = transcript.trim();
      recognizedSpeech = Boolean(latestTranscript);
      textarea.value = [original, latestTranscript].filter(Boolean).join(' ').trim();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };

    recognition.onerror = (event) => {
      recognitionFailed = true;
      recognition = null;
      button.dataset.listening = 'false';
      button.textContent = '🎙 Voice / Listen';
      button.title = event?.error ? 'Voice input error: ' + event.error : 'Voice input failed.';
    };

    recognition.onend = () => {
      recognition = null;
      button.dataset.listening = 'false';
      button.textContent = '🎙 Voice / Listen';

      const finalValue = textarea.value.trim();
      if (!recognitionFailed && recognizedSpeech && finalValue) {
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => {
          const sent = submitComposer(textarea);
          if (!sent) textarea.focus();
        }, 120);
        return;
      }

      textarea.focus();
    };

    recognition.start();
  }

  function mount() {
    if (document.getElementById('unboundVoiceListenButton')) return;
    const send = document.querySelector('#sendButton, .send, button[type="submit"]');
    if (!send || !send.parentNode) return;

    const wrap = document.createElement('div');
    wrap.className = 'voice-listen-wrap';

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'unboundVoiceListenButton';
    button.className = 'voice-listen-button';
    button.textContent = '🎙 Voice / Listen';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.title = 'Use voice input, choose a voice, or listen to the latest UNBOUND AI answer';

    const menu = document.createElement('div');
    menu.className = 'voice-listen-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    const voiceInput = document.createElement('button');
    voiceInput.type = 'button';
    voiceInput.className = 'voice-listen-action';
    voiceInput.textContent = '🎙 Voice input';

    const picker = document.createElement('div');
    picker.className = 'voice-picker';

    const pickerLabel = document.createElement('label');
    pickerLabel.className = 'voice-picker-label';
    pickerLabel.setAttribute('for', 'unboundVoicePreset');
    pickerLabel.textContent = 'Spoken answer voice';

    const pickerSelect = document.createElement('select');
    pickerSelect.id = 'unboundVoicePreset';
    pickerSelect.className = 'voice-picker-select';
    for (const preset of VOICE_PRESETS) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      pickerSelect.appendChild(option);
    }
    pickerSelect.value = getSelectedPresetId();

    const pickerNote = document.createElement('div');
    pickerNote.className = 'voice-picker-note';
    pickerNote.textContent = 'Uses the most natural English voice available on this device. Your choice is saved.';

    picker.append(pickerLabel, pickerSelect, pickerNote);

    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'voice-listen-action';
    preview.textContent = '▶ Preview selected voice';

    const listen = document.createElement('button');
    listen.type = 'button';
    listen.className = 'voice-listen-action';
    listen.textContent = '🔊 Listen to last answer';

    menu.append(voiceInput, picker, preview, listen);
    wrap.append(button, menu);
    send.parentNode.insertBefore(wrap, send);

    function closeMenu() {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }

    button.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      button.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    });
    voiceInput.addEventListener('click', () => { closeMenu(); startVoiceInput(button); });
    pickerSelect.addEventListener('change', () => {
      saveSelectedPreset(pickerSelect.value);
      stopBrowserSpeech();
      previewSelectedVoice(button);
    });
    preview.addEventListener('click', () => { previewSelectedVoice(button); });
    listen.addEventListener('click', () => { closeMenu(); void listenToLastAnswer(button); });
    document.addEventListener('click', (event) => {
      if (!wrap.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu();
        stopBrowserSpeech();
      }
    });

    if ('speechSynthesis' in window) {
      const refresh = () => {
        const preset = getSelectedPreset();
        const resolved = resolveVoiceForPreset(preset);
        pickerSelect.title = resolved ? 'Using ' + resolved.name : 'Using browser default voice';
      };
      refresh();
      window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    }
  }

  window.addEventListener('DOMContentLoaded', mount);
  if (document.readyState !== 'loading') mount();
})();
</script>`;

function injectVoiceListenControl(html) {
  const source = String(html || "");
  if (source.includes(`id="${VOICE_LISTEN_STYLE_ID}"`) || source.includes(`id="${VOICE_LISTEN_SCRIPT_ID}"`)) return source;
  const head = source.lastIndexOf("</head>");
  const body = source.lastIndexOf("</body>");
  if (head === -1 || body === -1) throw new Error("UNBOUND AI voice/listen UI markers are missing.");
  const withStyle = source.slice(0, head) + VOICE_LISTEN_STYLES + "\n" + source.slice(head);
  const finalBody = withStyle.lastIndexOf("</body>");
  return withStyle.slice(0, finalBody) + VOICE_LISTEN_SCRIPT + "\n" + withStyle.slice(finalBody);
}

module.exports = {
  VOICE_LISTEN_STYLE_ID,
  VOICE_LISTEN_SCRIPT_ID,
  VOICE_LISTEN_STYLES,
  VOICE_LISTEN_SCRIPT,
  injectVoiceListenControl
};
