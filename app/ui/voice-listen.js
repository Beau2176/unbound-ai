const VOICE_LISTEN_STYLE_ID = "unbound-voice-listen-v099";
const VOICE_LISTEN_SCRIPT_ID = "unbound-voice-listen-v099";

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
  min-width: 190px;
  padding: 7px;
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
.voice-listen-button[data-listening="true"] {
  border-color: rgba(255,118,118,.75);
  box-shadow: 0 0 0 3px rgba(255,118,118,.12);
}
@media (max-width: 760px) {
  .voice-listen-button { min-height: 46px; padding: 0 10px; font-size: 12px; }
  .voice-listen-menu { min-width: 176px; }
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

  function getUsEnglishVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    const usEnglish = voices.filter((voice) => /^en[-_]US$/i.test(String(voice?.lang || '')));
    return usEnglish.find((voice) => /Google US English/i.test(String(voice?.name || '')))
      || usEnglish.find((voice) => /natural|neural|enhanced|premium/i.test(String(voice?.name || '')))
      || usEnglish[0]
      || null;
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

  async function listenToLastAnswer(button) {
    const text = getLastAssistantText();
    if (!text) {
      button.title = 'No UNBOUND AI answer is available to read yet.';
      return;
    }

    try {
      button.disabled = true;
      const response = await fetch('/api/voice/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text, locale: 'en-US' })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.audioUrl) throw new Error(payload.error || 'Voice playback is unavailable.');
      if (audio) {
        try { audio.pause(); } catch (_) {}
      }
      audio = new Audio(payload.audioUrl);
      await audio.play();
    } catch (error) {
      if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function') {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = getUsEnglishVoice();
        if (voice) utterance.voice = voice;
        utterance.lang = 'en-US';
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;
        window.speechSynthesis.speak(utterance);
      } else {
        button.title = error.message || 'Voice playback is unavailable.';
      }
    } finally {
      button.disabled = false;
    }
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
    recognition.lang = 'en-US';
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
    button.title = 'Use U.S. English voice input or listen to the latest UNBOUND AI answer';

    const menu = document.createElement('div');
    menu.className = 'voice-listen-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    const voiceInput = document.createElement('button');
    voiceInput.type = 'button';
    voiceInput.className = 'voice-listen-action';
    voiceInput.textContent = '🎙 Voice input';

    const listen = document.createElement('button');
    listen.type = 'button';
    listen.className = 'voice-listen-action';
    listen.textContent = '🔊 Listen to last answer';

    menu.append(voiceInput, listen);
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
    listen.addEventListener('click', () => { closeMenu(); void listenToLastAnswer(button); });
    document.addEventListener('click', (event) => {
      if (!wrap.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });
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