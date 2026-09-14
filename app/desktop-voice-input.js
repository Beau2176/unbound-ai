(() => {
  if (window.matchMedia && !window.matchMedia('(min-width: 761px)').matches) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;

  const MAX_NO_SPEECH_RETRIES = 3;
  let recognition = null;
  let noSpeechRetries = 0;
  let retryTimer = null;

  function markMicrophoneWorking(detail = {}) {
    window.__UNBOUND_MICROPHONE_WORKING__ = true;
    window.dispatchEvent(new CustomEvent('unbound:microphone-state', {
      detail: { working: true, ...detail }
    }));
  }

  function getMessageBox() { return document.getElementById('message'); }
  function getVoiceButton() { return document.getElementById('unboundVoiceListenButton'); }

  function getStatusNode() {
    let node = document.getElementById('desktopVoiceStatus');
    if (node) return node;
    const form = document.getElementById('chatForm');
    if (!form || !form.parentNode) return null;
    node = document.createElement('div');
    node.id = 'desktopVoiceStatus';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.style.margin = '8px 4px 0';
    node.style.fontSize = '12px';
    node.style.lineHeight = '1.4';
    node.style.color = '#b9d9ef';
    node.style.minHeight = '17px';
    form.parentNode.insertBefore(node, form.nextSibling);
    return node;
  }

  function setStatus(message, kind = 'info') {
    const node = getStatusNode();
    if (!node) return;
    node.textContent = message || '';
    node.style.color = kind === 'error' ? '#ffd4d4' : kind === 'success' ? '#9cf2c5' : '#b9d9ef';
  }

  function clearRetryTimer() {
    if (!retryTimer) return;
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }

  function resetButton(message, kind = 'info') {
    clearRetryTimer();
    const button = getVoiceButton();
    if (button) {
      button.dataset.listening = 'false';
      button.textContent = '🎙 Voice / Listen';
      if (message) button.title = message;
    }
    if (message) setStatus(message, kind);
  }

  function submitMessage() {
    const send = document.getElementById('sendButton');
    if (send && !send.disabled) { send.click(); return true; }
    const form = document.getElementById('chatForm');
    if (form && typeof form.requestSubmit === 'function') { form.requestSubmit(); return true; }
    return false;
  }

  async function microphonePreflight() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('This browser cannot directly access the desktop microphone.');
    }
    setStatus('Checking desktop microphone permission and audio device…');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    try {
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== 'live') throw new Error('Chrome did not return a live microphone audio track.');
      const label = String(track.label || '').trim();
      markMicrophoneWorking({ source: 'getUserMedia', label: label || null });
      setStatus(label ? `Microphone connected: ${label}` : 'Microphone connected and permission granted.');
      return label;
    } finally {
      stream.getTracks().forEach((track) => { try { track.stop(); } catch (_) {} });
    }
  }

  async function startDesktopRecognition({ skipPreflight = false, retry = false } = {}) {
    const textarea = getMessageBox();
    const button = getVoiceButton();
    if (!textarea || !button) return;

    if (!retry) { noSpeechRetries = 0; clearRetryTimer(); }
    if (recognition) { try { recognition.stop(); } catch (_) {} return; }

    if (!skipPreflight) {
      button.textContent = 'Checking mic…';
      button.title = 'Checking desktop microphone permission';
      try {
        await microphonePreflight();
      } catch (error) {
        const name = String(error?.name || '');
        const message = name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access is blocked for UNBOUND AI. Allow the microphone for this site in Chrome, then try again.'
          : name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'Chrome cannot find a microphone on this computer.'
            : name === 'NotReadableError' || name === 'TrackStartError'
              ? 'The microphone is busy or unavailable to Chrome. Close other apps using it and try again.'
              : (error?.message || 'Desktop microphone check failed.');
        resetButton(message, 'error');
        return;
      }
    }

    const original = textarea.value.trim();
    let transcript = '';
    let started = false;
    let speechDetected = false;
    let failed = false;
    let retryNoSpeech = false;

    recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    button.textContent = retry ? '● Still listening…' : 'Starting speech…';
    button.title = 'Microphone permission is good. Starting Chrome speech recognition.';
    setStatus(retry
      ? `Still listening… speak now. Retry ${noSpeechRetries} of ${MAX_NO_SPEECH_RETRIES}.`
      : 'Microphone is connected. Starting speech recognition…');

    recognition.onstart = () => {
      started = true;
      markMicrophoneWorking({ source: 'speech-recognition' });
      button.dataset.listening = 'true';
      button.textContent = retry ? '● Still listening…' : '● Listening…';
      button.title = 'Microphone is active';
      setStatus(retry
        ? `Still listening… speak normally into the microphone. Retry ${noSpeechRetries} of ${MAX_NO_SPEECH_RETRIES}.`
        : 'Listening… speak normally into the connected microphone.');
    };

    recognition.onspeechstart = () => {
      speechDetected = true;
      noSpeechRetries = 0;
      markMicrophoneWorking({ source: 'speech-detected' });
      button.textContent = '● Hearing you…';
      setStatus('Voice detected. Converting speech to text…');
    };

    recognition.onaudiostart = () => {
      markMicrophoneWorking({ source: 'audio-start' });
      if (!speechDetected) setStatus('Microphone audio is reaching Chrome. Waiting for speech…');
    };

    recognition.onresult = (event) => {
      let combined = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const part = event.results[i] && event.results[i][0] ? event.results[i][0].transcript : '';
        combined += part || '';
      }
      transcript = combined.trim();
      if (!transcript) return;
      markMicrophoneWorking({ source: 'transcript' });
      textarea.value = [original, transcript].filter(Boolean).join(' ').trim();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      button.textContent = 'Transcribing…';
      setStatus(`Heard: “${transcript}”`, 'success');
    };

    recognition.onnomatch = () => {
      failed = true;
      resetButton('Chrome received microphone audio but could not recognize the words. Try speaking a little slower and closer to the microphone.', 'error');
    };

    recognition.onerror = (event) => {
      const code = event && event.error ? event.error : 'unknown';
      if (code === 'no-speech') {
        retryNoSpeech = true;
        setStatus('The microphone is open but no speech was detected yet. UNBOUND AI will keep listening…');
        return;
      }
      failed = true;
      const messages = {
        'not-allowed': 'Chrome blocked microphone or speech-recognition permission for this site.',
        'service-not-allowed': 'Chrome speech recognition service is blocked on this computer.',
        'audio-capture': 'Chrome lost access to the microphone after permission was granted.',
        'network': 'Chrome could not reach its speech-recognition service. The microphone itself is working.'
      };
      resetButton(messages[code] || ('Voice input error: ' + code), 'error');
    };

    recognition.onend = () => {
      recognition = null;
      const finalText = textarea.value.trim();
      if (retryNoSpeech && !transcript && !failed) {
        if (noSpeechRetries < MAX_NO_SPEECH_RETRIES) {
          noSpeechRetries += 1;
          button.dataset.listening = 'true';
          button.textContent = '● Still listening…';
          setStatus(`I did not hear speech yet. Keeping the microphone open and trying again… ${noSpeechRetries}/${MAX_NO_SPEECH_RETRIES}`);
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            void startDesktopRecognition({ skipPreflight: true, retry: true });
          }, 350);
          return;
        }
        noSpeechRetries = 0;
        resetButton('The microphone is open, but Chrome still is not detecting your voice. Check the Windows input microphone, make sure it is not muted, and raise its input volume.', 'error');
        textarea.focus();
        return;
      }
      if (!failed && started && transcript && finalText) {
        noSpeechRetries = 0;
        markMicrophoneWorking({ source: 'recognized-question' });
        resetButton('Voice question recognized. Sending it to UNBOUND AI…', 'success');
        window.setTimeout(() => {
          if (!submitMessage()) {
            resetButton('The words were recognized, but the Send button could not be activated.', 'error');
            textarea.focus();
          }
        }, 120);
        return;
      }
      if (!failed) {
        noSpeechRetries = 0;
        if (started && speechDetected) {
          resetButton('Chrome detected your voice but returned no transcript. This points to Chrome speech recognition, not the microphone.', 'error');
        } else if (started) {
          resetButton('The microphone is connected, but Chrome did not detect speech. Check the selected Windows input microphone and its input level.', 'error');
        } else {
          resetButton('The microphone permission check passed, but Chrome did not start speech recognition.', 'error');
        }
      }
      textarea.focus();
    };

    try { recognition.start(); }
    catch (error) {
      recognition = null;
      noSpeechRetries = 0;
      resetButton(error?.message || 'Could not start Chrome speech recognition.', 'error');
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
    void startDesktopRecognition();
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', getStatusNode, { once: true });
  else getStatusNode();
})();
