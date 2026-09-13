(() => {
  if (window.matchMedia && !window.matchMedia('(min-width: 761px)').matches) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;

  let recognition = null;

  function getMessageBox() {
    return document.getElementById('message');
  }

  function getVoiceButton() {
    return document.getElementById('unboundVoiceListenButton');
  }

  function resetButton(message) {
    const button = getVoiceButton();
    if (!button) return;
    button.dataset.listening = 'false';
    button.textContent = '🎙 Voice / Listen';
    if (message) button.title = message;
  }

  function submitMessage() {
    const send = document.getElementById('sendButton');
    if (send && !send.disabled) {
      send.click();
      return true;
    }
    const form = document.getElementById('chatForm');
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return true;
    }
    return false;
  }

  function startDesktopRecognition() {
    const textarea = getMessageBox();
    const button = getVoiceButton();
    if (!textarea || !button) return;

    if (recognition) {
      try { recognition.stop(); } catch (_) {}
      return;
    }

    const original = textarea.value.trim();
    let transcript = '';
    let started = false;
    let failed = false;

    recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    button.textContent = 'Starting mic…';
    button.title = 'Waiting for Chrome to start the microphone';

    recognition.onstart = () => {
      started = true;
      button.dataset.listening = 'true';
      button.textContent = '● Listening…';
      button.title = 'Microphone is active';
    };

    recognition.onspeechstart = () => {
      button.textContent = '● Hearing you…';
    };

    recognition.onresult = (event) => {
      let combined = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const part = event.results[i] && event.results[i][0] ? event.results[i][0].transcript : '';
        combined += part || '';
      }
      transcript = combined.trim();
      if (!transcript) return;

      textarea.value = [original, transcript].filter(Boolean).join(' ').trim();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      button.textContent = 'Transcribing…';
    };

    recognition.onnomatch = () => {
      failed = true;
      resetButton('Chrome heard audio but could not recognize speech. Try speaking closer to the microphone.');
    };

    recognition.onerror = (event) => {
      failed = true;
      const code = event && event.error ? event.error : 'unknown';
      const messages = {
        'not-allowed': 'Microphone permission is blocked for UNBOUND AI in Chrome.',
        'service-not-allowed': 'Chrome speech recognition service is blocked on this computer.',
        'audio-capture': 'Chrome cannot access a working microphone on this computer.',
        'no-speech': 'No speech was detected. Try again and speak after the microphone starts.',
        'network': 'Chrome speech recognition could not reach its speech service.'
      };
      resetButton(messages[code] || ('Voice input error: ' + code));
    };

    recognition.onend = () => {
      recognition = null;
      const finalText = textarea.value.trim();
      if (!failed && started && transcript && finalText) {
        resetButton('Voice question recognized and sent to UNBOUND AI');
        window.setTimeout(() => {
          if (!submitMessage()) textarea.focus();
        }, 100);
        return;
      }

      if (!failed) {
        resetButton(started
          ? 'The microphone started, but Chrome returned no transcript. Check the selected microphone and site permission.'
          : 'Chrome did not start speech recognition. Check microphone permission for this site.');
      }
      textarea.focus();
    };

    try {
      recognition.start();
    } catch (error) {
      recognition = null;
      resetButton(error?.message || 'Could not start microphone input.');
    }
  }

  document.addEventListener('click', (event) => {
    if (!window.matchMedia || !window.matchMedia('(min-width: 761px)').matches) return;
    const target = event.target?.closest?.('.voice-listen-action');
    if (!target || !String(target.textContent || '').includes('Voice input')) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const menu = target.closest('.voice-listen-menu');
    if (menu) menu.hidden = true;
    const button = getVoiceButton();
    if (button) button.setAttribute('aria-expanded', 'false');
    startDesktopRecognition();
  }, true);
})();
