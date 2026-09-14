(() => {
  'use strict';

  const ACTION_ID = 'unboundHandsFreeVoice';
  const STATUS_ID = 'unboundHandsFreeStatus';
  const STYLE_ID = 'unbound-hands-free-v099';
  const MAX_NO_SPEECH_RETRIES = 3;
  const REPLY_TIMEOUT_MS = 180000;
  const VOICE2_PREFERRED = ['Google US English', 'Sonia', 'Serena', 'Libby', 'Hazel', 'Susan'];

  let active = false;
  let recognition = null;
  let phase = 'idle';
  let generation = 0;
  let noSpeechRetries = 0;
  let restartTimer = null;
  let cachedVoice = null;

  function RecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function getTextarea() {
    return document.querySelector('#message, .composer textarea, textarea[name="message"]');
  }

  function getSendButton() {
    return document.getElementById('sendButton') || document.querySelector('.send, button[type="submit"]');
  }

  function getVoiceButton() {
    return document.getElementById('unboundVoiceListenButton');
  }

  function getMenu() {
    return getVoiceButton()?.closest('.voice-listen-wrap')?.querySelector('.voice-listen-menu') || null;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.unbound-handsfree-action[data-active="true"]{background:rgba(101,232,164,.13);color:#baf8d7;}',
      '.unbound-handsfree-status{margin:5px 4px 4px;padding:7px 8px;border-radius:9px;background:rgba(255,255,255,.035);color:#9fb8ca;font-size:10px;line-height:1.35;}',
      '.unbound-handsfree-status[data-kind="error"]{color:#ffd0d0;background:rgba(120,24,32,.12);}',
      '.unbound-handsfree-status[data-kind="active"]{color:#baf8d7;background:rgba(19,91,59,.15);}'
    ].join('');
    document.head.appendChild(style);
  }

  function statusNode() {
    return document.getElementById(STATUS_ID);
  }

  function actionNode() {
    return document.getElementById(ACTION_ID);
  }

  function setStatus(message, kind = 'info') {
    const node = statusNode();
    if (!node) return;
    node.textContent = message || '';
    node.dataset.kind = kind;
  }

  function setActionState() {
    const action = actionNode();
    if (!action) return;
    action.dataset.active = active ? 'true' : 'false';
    action.textContent = active ? '🗣 Hands-Free Conversation: ON' : '🗣 Hands-Free Conversation: OFF';
    action.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function setConflictingActionsDisabled(disabled) {
    const menu = getMenu();
    if (!menu) return;
    for (const item of menu.querySelectorAll('.voice-listen-action')) {
      if (item.id === ACTION_ID) continue;
      const text = String(item.textContent || '');
      if (/Voice input|Listen to last answer|Preview selected voice/i.test(text)) {
        item.disabled = Boolean(disabled);
      }
    }
  }

  function clearRestartTimer() {
    if (!restartTimer) return;
    window.clearTimeout(restartTimer);
    restartTimer = null;
  }

  function stopRecognition() {
    const current = recognition;
    recognition = null;
    if (!current) return;
    current.__unboundIntentionalStop = true;
    try { current.abort(); } catch (_) {
      try { current.stop(); } catch (_) {}
    }
  }

  function stopSpeech() {
    if (!('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }

  function stopHandsFree(message = 'Hands-Free Conversation is off.', kind = 'info') {
    generation += 1;
    active = false;
    phase = 'idle';
    noSpeechRetries = 0;
    clearRestartTimer();
    stopRecognition();
    stopSpeech();
    setConflictingActionsDisabled(false);
    setActionState();
    setStatus(message, kind);
    const button = getVoiceButton();
    if (button) button.dataset.listening = 'false';
  }

  async function hasVoiceAccess() {
    try {
      const response = await fetch('/api/account/access', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          allowed: false,
          message: response.status === 401
            ? 'Sign in before using Hands-Free Conversation.'
            : (payload.error || 'Could not verify Voice access.')
        };
      }
      const capabilities = payload?.access?.capabilities || [];
      const voice = capabilities.find((item) => item?.key === 'voice');
      return {
        allowed: Boolean(voice?.usable),
        message: voice?.usable
          ? null
          : 'Hands-Free Conversation requires Premium or Ultra Voice access.'
      };
    } catch (_) {
      return { allowed: false, message: 'Could not verify Voice access right now.' };
    }
  }

  function voiceScore(voice) {
    const name = String(voice?.name || '');
    const lang = String(voice?.lang || '');
    let score = 0;
    if (/natural/i.test(name)) score += 500;
    if (/neural/i.test(name)) score += 450;
    if (/online/i.test(name)) score += 300;
    if (/google/i.test(name)) score += 250;
    if (/microsoft/i.test(name)) score += 180;
    if (/enhanced|premium/i.test(name)) score += 160;
    if (/^en(?:-|$)/i.test(lang)) score += 80;
    if (voice?.default) score += 25;
    return score;
  }

  function resolveVoice2() {
    if (cachedVoice) return cachedVoice;
    if (!('speechSynthesis' in window)) return null;
    const all = window.speechSynthesis.getVoices() || [];
    const english = all.filter((voice) => /^en(?:-|$)/i.test(String(voice.lang || '')));
    const voices = (english.length ? english : all).slice().sort((a, b) => voiceScore(b) - voiceScore(a));
    for (const preferred of VOICE2_PREFERRED) {
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

  function cleanSpeechText(value) {
    return String(value || '')
      .replace(/\[Response interrupted before completion\.\]/gi, ' ')
      .replace(/https?:\/\/\S+/g, ' link ')
      .replace(/[*_#>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitSpeech(value, limit = 560) {
    const text = cleanSpeechText(value);
    if (!text) return [];
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const chunks = [];
    let current = '';
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const combined = `${current} ${sentence}`.trim();
      if (combined.length <= limit) {
        current = combined;
      } else {
        if (current) chunks.push(current);
        current = sentence;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function speakVoice2(text, token) {
    return new Promise((resolve) => {
      if (!active || token !== generation || !('speechSynthesis' in window)) return resolve(false);
      if (typeof window.SpeechSynthesisUtterance !== 'function') return resolve(false);
      const chunks = splitSpeech(text);
      if (!chunks.length) return resolve(false);
      const synth = window.speechSynthesis;
      const voice = resolveVoice2();
      try { synth.cancel(); } catch (_) {}
      let index = 0;
      let settled = false;

      function finish(ok) {
        if (settled) return;
        settled = true;
        resolve(ok);
      }

      function next() {
        if (!active || token !== generation) return finish(false);
        if (index >= chunks.length) return finish(true);
        const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
        if (voice) utterance.voice = voice;
        utterance.lang = voice?.lang || 'en-US';
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.onend = () => {
          index += 1;
          window.setTimeout(next, 5);
        };
        utterance.onerror = () => finish(false);
        try { synth.speak(utterance); } catch (_) { finish(false); }
      }

      next();
    });
  }

  function assistantSnapshot() {
    const nodes = Array.from(document.querySelectorAll('.message.assistant'));
    const node = nodes[nodes.length - 1] || null;
    return {
      count: nodes.length,
      text: String(node?.innerText || node?.textContent || '').trim(),
      error: Boolean(node?.classList?.contains('error'))
    };
  }

  function submitComposer() {
    const textarea = getTextarea();
    const send = getSendButton();
    if (!textarea || !textarea.value.trim() || !send || send.disabled) return false;
    send.click();
    return true;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function waitForCompletedReply(before, token) {
    const send = getSendButton();
    if (!send) return null;
    const startedAt = Date.now();
    let sawPending = send.disabled;

    while (active && token === generation && Date.now() - startedAt < REPLY_TIMEOUT_MS) {
      if (send.disabled) sawPending = true;
      const current = assistantSnapshot();
      if (sawPending && !send.disabled && current.count > before.count) {
        if (!current.text) return null;
        return current;
      }
      await sleep(120);
    }
    return null;
  }

  function isStopPhrase(value) {
    const text = String(value || '').trim().toLowerCase().replace(/[.!?]+$/g, '');
    return /^(stop|end|cancel|pause)( hands[ -]?free( conversation)?| listening| conversation)$/.test(text)
      || text === 'stop hands free'
      || text === 'end hands free';
  }

  function isEditingKey(event) {
    if (!event || event.isComposing) return true;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const key = String(event.key || '');
    return key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(key);
  }

  function scheduleListen(token, delay = 250) {
    if (!active || token !== generation) return;
    clearRestartTimer();
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      if (!active || token !== generation) return;
      if (document.hidden) {
        phase = 'paused';
        setStatus('Hands-Free is paused while UNBOUND AI is in the background. It will resume when you return.', 'active');
        return;
      }
      startListening(token);
    }, delay);
  }

  async function handleRecognizedText(text, token) {
    const textarea = getTextarea();
    if (!textarea || !active || token !== generation) return;
    if (isStopPhrase(text)) {
      stopHandsFree('Hands-Free Conversation stopped by voice command.');
      return;
    }

    textarea.value = text.trim();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    const before = assistantSnapshot();
    phase = 'waiting';
    setStatus('Question recognized. Waiting for UNBOUND AI to finish replying…', 'active');

    if (!submitComposer()) {
      stopHandsFree('Could not send the recognized question. Hands-Free stopped.', 'error');
      return;
    }

    const reply = await waitForCompletedReply(before, token);
    if (!active || token !== generation) return;
    if (!reply) {
      stopHandsFree('UNBOUND AI did not finish a reply before the Hands-Free timeout.', 'error');
      return;
    }
    if (reply.error || /Response interrupted before completion/i.test(reply.text)) {
      setStatus('The reply was interrupted, so it will not be read aloud. Listening again…', 'error');
      scheduleListen(token, 700);
      return;
    }

    phase = 'speaking';
    setStatus('UNBOUND AI is speaking with Voice 2 — Clear…', 'active');
    const spoken = await speakVoice2(reply.text, token);
    if (!active || token !== generation) return;
    if (!spoken) {
      setStatus('Voice 2 playback was unavailable. Listening again…', 'error');
    } else {
      setStatus('Reply finished. Listening for your next question…', 'active');
    }
    scheduleListen(token, 300);
  }

  function startListening(token = generation) {
    if (!active || token !== generation || recognition || document.hidden) return;
    const Recognition = RecognitionCtor();
    const textarea = getTextarea();
    const send = getSendButton();
    if (!Recognition || !textarea || !send) {
      stopHandsFree('This browser cannot run Hands-Free Conversation.', 'error');
      return;
    }
    if (send.disabled) {
      scheduleListen(token, 500);
      return;
    }

    let transcript = '';
    let failed = false;
    let noSpeech = false;
    const current = new Recognition();
    recognition = current;
    current.lang = navigator.language || 'en-US';
    current.interimResults = true;
    current.continuous = false;
    current.maxAlternatives = 1;

    phase = 'listening';
    setStatus('Hands-Free is listening. Say “stop hands free” to end.', 'active');
    const button = getVoiceButton();
    if (button) button.dataset.listening = 'true';

    current.onresult = (event) => {
      let combined = '';
      for (let index = 0; index < event.results.length; index += 1) {
        combined += event.results[index]?.[0]?.transcript || '';
      }
      transcript = combined.trim();
      if (transcript) setStatus(`Heard: “${transcript}”`, 'active');
    };

    current.onerror = (event) => {
      if (current.__unboundIntentionalStop) return;
      const code = String(event?.error || 'unknown');
      if (code === 'no-speech') {
        noSpeech = true;
        return;
      }
      failed = true;
      const message = {
        'not-allowed': 'Microphone permission is blocked for UNBOUND AI.',
        'service-not-allowed': 'Browser speech recognition is blocked on this device.',
        'audio-capture': 'The microphone is unavailable to the browser.',
        'network': 'Browser speech recognition lost its network service.'
      }[code] || `Voice input error: ${code}`;
      setStatus(message, 'error');
    };

    current.onend = () => {
      if (recognition === current) recognition = null;
      const buttonNow = getVoiceButton();
      if (buttonNow) buttonNow.dataset.listening = 'false';
      if (current.__unboundIntentionalStop) return;
      if (!active || token !== generation) return;

      if (failed) {
        stopHandsFree(statusNode()?.textContent || 'Voice input failed.', 'error');
        return;
      }
      if (transcript) {
        noSpeechRetries = 0;
        void handleRecognizedText(transcript, token);
        return;
      }
      if (noSpeech && noSpeechRetries < MAX_NO_SPEECH_RETRIES) {
        noSpeechRetries += 1;
        setStatus(`No speech heard yet. Keeping Hands-Free open… ${noSpeechRetries}/${MAX_NO_SPEECH_RETRIES}`, 'active');
        scheduleListen(token, 350);
        return;
      }
      noSpeechRetries = 0;
      stopHandsFree('No speech was detected after several tries. Tap Hands-Free to start again.', 'error');
    };

    try { current.start(); }
    catch (error) {
      recognition = null;
      stopHandsFree(error?.message || 'Could not start browser speech recognition.', 'error');
    }
  }

  async function startHandsFree() {
    if (active) {
      stopHandsFree();
      return;
    }
    if (!RecognitionCtor()) {
      setStatus('This browser does not support speech recognition for Hands-Free Conversation.', 'error');
      return;
    }
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') {
      setStatus('This browser does not support spoken replies for Hands-Free Conversation.', 'error');
      return;
    }

    setStatus('Checking Premium/Ultra Voice access…');
    const access = await hasVoiceAccess();
    if (!access.allowed) {
      setStatus(access.message, 'error');
      return;
    }

    generation += 1;
    active = true;
    phase = 'starting';
    noSpeechRetries = 0;
    setConflictingActionsDisabled(true);
    setActionState();
    const menu = getMenu();
    if (menu) menu.hidden = true;
    const button = getVoiceButton();
    if (button) button.setAttribute('aria-expanded', 'false');
    setStatus('Hands-Free Conversation is on. Voice 2 — Clear keeps spoken replies local and instant.', 'active');
    resolveVoice2();
    scheduleListen(generation, 150);
  }

  function mount() {
    if (document.getElementById(ACTION_ID)) return true;
    const menu = getMenu();
    if (!menu) return false;
    injectStyles();

    const action = document.createElement('button');
    action.type = 'button';
    action.id = ACTION_ID;
    action.className = 'voice-listen-action unbound-handsfree-action';
    action.setAttribute('aria-pressed', 'false');

    const status = document.createElement('div');
    status.id = STATUS_ID;
    status.className = 'unbound-handsfree-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Hands-Free is off. Premium/Ultra required; spoken replies use local Voice 2 — Clear.';

    const firstAction = menu.querySelector('.voice-listen-action');
    if (firstAction) menu.insertBefore(action, firstAction);
    else menu.appendChild(action);
    menu.appendChild(status);
    setActionState();

    action.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void startHandsFree();
    });

    const textarea = getTextarea();
    textarea?.addEventListener('keydown', (event) => {
      if (!active || !event.isTrusted || !isEditingKey(event)) return;
      stopHandsFree('Hands-Free stopped because you started typing.');
    });

    document.addEventListener('visibilitychange', () => {
      if (!active) return;
      if (document.hidden) {
        clearRestartTimer();
        stopRecognition();
        phase = 'paused';
        setStatus('Hands-Free paused the microphone while UNBOUND AI is in the background.', 'active');
        return;
      }
      setStatus('Hands-Free is back. Resuming the microphone…', 'active');
      scheduleListen(generation, 500);
    });

    window.addEventListener('pagehide', () => {
      if (active) stopHandsFree('Hands-Free stopped because the page closed.');
    });

    if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', () => { cachedVoice = null; });
    }

    return true;
  }

  function boot() {
    if (mount()) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (mount() || attempts >= 60) window.clearInterval(timer);
    }, 125);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
