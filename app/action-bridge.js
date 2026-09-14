(() => {
  const originalFetch = window.fetch.bind(window);
  const URL_RE = /https:\/\/[^\s<>"')\]]+/i;
  const ACTION_RE = /\b(open|go to|visit|click|fill|submit|sign up|signup|register|apply|book|reserve|send|enter|complete|check out|checkout|buy|order)\b/i;
  const DEVICE_RE = /\b(inspect|check|diagnose|look at|scan|show)\b[\s\S]{0,40}\b(device|phone|computer|pc|apps?|processes?|storage|memory|hardware|system)\b/i;
  const CONFIRM_RE = /^\s*confirm browser action\s+([0-9a-f-]{20,})\s*$/i;

  function streamResponse(reply, extra = {}) {
    const text = [
      JSON.stringify({ type:'meta', provider:'unbound-action', model:'action-control-v1', ...extra }),
      JSON.stringify({ type:'delta', delta:String(reply || '') }),
      JSON.stringify({ type:'done', provider:'unbound-action', model:'action-control-v1', ...extra })
    ].join('\n') + '\n';
    return new Response(text, { status:200, headers:{ 'Content-Type':'application/x-ndjson', 'Cache-Control':'no-store' } });
  }

  function jsonResponse(reply, extra = {}) {
    return new Response(JSON.stringify({
      reply:String(reply || ''),
      provider:'unbound-action',
      model:'action-control-v1',
      sources:[],
      citations:[],
      webSearchCalls:0,
      ...extra
    }), { status:200, headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' } });
  }

  function respond(streaming, reply, extra = {}) {
    return streaming ? streamResponse(reply, extra) : jsonResponse(reply, extra);
  }

  async function browserTask(message, streaming) {
    const match = String(message || '').match(URL_RE);
    if (!match || !ACTION_RE.test(message)) return null;
    const response = await originalFetch('/api/actions/browser/task', {
      method:'POST',
      credentials:'same-origin',
      headers:{ 'Content-Type':'application/json', Accept:'application/json' },
      body:JSON.stringify({ url:match[0], goal:message })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) {
      return respond(streaming, `Browser control could not start: ${data.error || 'unknown error'}`);
    }
    if (data.confirmationRequired) {
      const label = data.pendingAction?.label ? ` “${data.pendingAction.label}”` : '';
      return respond(
        streaming,
        `I reached a final action${label} that could submit, send, purchase, book, apply, delete, publish, transfer, or otherwise change something. I stopped before doing it.\n\nTo authorize that exact next step, reply:\n\nconfirm browser action ${data.taskId}`,
        { browserTaskId:data.taskId, confirmationRequired:true }
      );
    }
    return respond(
      streaming,
      data.message || `Browser task finished at ${data.page?.url || data.targetUrl || match[0]}.`,
      { browserTaskId:data.taskId }
    );
  }

  async function browserConfirmation(taskId, streaming) {
    const response = await originalFetch(`/api/actions/browser/task/${encodeURIComponent(taskId)}/confirm`, {
      method:'POST',
      credentials:'same-origin',
      headers:{ 'Content-Type':'application/json', Accept:'application/json' },
      body:'{}'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) {
      return respond(streaming, `Browser action confirmation failed: ${data.error || 'unknown error'}`);
    }
    if (data.confirmationRequired) {
      return respond(
        streaming,
        `The browser reached another final action. To authorize that next step, reply:\n\nconfirm browser action ${data.taskId}`,
        { browserTaskId:data.taskId, confirmationRequired:true }
      );
    }
    return respond(streaming, data.message || 'The confirmed browser action completed.', { browserTaskId:data.taskId });
  }

  async function deviceTask(message, streaming) {
    if (!DEVICE_RE.test(String(message || '')) || !window.UNBOUND_DEVICE_INSPECTOR) return null;
    try {
      const result = await window.UNBOUND_DEVICE_INSPECTOR.analyze(message);
      return respond(streaming, result.reply || 'Device inspection completed.', { deviceInspection:true });
    } catch (error) {
      return respond(streaming, `Device inspection could not complete: ${error.message || 'unknown error'}`, { deviceInspection:true });
    }
  }

  window.fetch = async function unboundActionFetch(input, init = {}) {
    try {
      const urlValue = typeof input === 'string' ? input : input?.url;
      const url = new URL(urlValue, location.href);
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const isStream = url.pathname === '/api/chat/stream';
      const isJsonChat = url.pathname === '/api/chat';
      if (url.origin === location.origin && (isStream || isJsonChat) && method === 'POST' && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        const message = String(body?.message || '');
        const confirm = message.match(CONFIRM_RE);
        if (confirm) return await browserConfirmation(confirm[1], isStream);
        const device = await deviceTask(message, isStream);
        if (device) return device;
        const browser = await browserTask(message, isStream);
        if (browser) return browser;
      }
    } catch (_) {}
    return originalFetch(input, init);
  };
})();