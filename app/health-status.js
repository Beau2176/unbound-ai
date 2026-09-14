(() => {
  const STYLE_ID = 'unbound-health-status-style-v110';
  const BAR_ID = 'unboundHealthStatusBar';
  const DETAILS_ID = 'unboundHealthStatusDetails';
  const ENDPOINT = '/health/diagnostics';
  const POLL_MS = 20000;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .unbound-health-bar{width:min(940px,100%);margin:0 auto 10px;border:1px solid rgba(255,255,255,.12);border-radius:14px;overflow:hidden;background:rgba(3,8,16,.9);box-shadow:0 10px 28px rgba(0,0,0,.24);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
      .unbound-health-main{width:100%;border:0;padding:9px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;color:#fff;background:#2e7d32;cursor:pointer;font:inherit;text-align:left}
      .unbound-health-bar[data-state="yellow"] .unbound-health-main{background:#9a6a00}.unbound-health-bar[data-state="red"] .unbound-health-main{background:#9b2424}.unbound-health-bar[data-state="checking"] .unbound-health-main{background:#24577f}
      .unbound-health-left{display:flex;align-items:center;gap:9px;min-width:0}.unbound-health-dot{width:10px;height:10px;border-radius:50%;background:#7CFF8A;box-shadow:0 0 12px rgba(124,255,138,.85);flex:0 0 auto}
      .unbound-health-bar[data-state="yellow"] .unbound-health-dot{background:#ffe36e;box-shadow:0 0 12px rgba(255,227,110,.85)}.unbound-health-bar[data-state="red"] .unbound-health-dot{background:#ff7d7d;box-shadow:0 0 12px rgba(255,125,125,.85)}.unbound-health-bar[data-state="checking"] .unbound-health-dot{background:#8ed0ff}
      .unbound-health-title{font-size:12px;font-weight:900;letter-spacing:.07em;text-transform:uppercase}.unbound-health-message{font-size:11px;font-weight:700;opacity:.92;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.unbound-health-time{font-size:10px;opacity:.8;white-space:nowrap}
      .unbound-health-details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:8px;background:rgba(3,8,16,.96)}.unbound-health-item{display:flex;justify-content:space-between;gap:8px;padding:7px 8px;border:1px solid rgba(255,255,255,.09);border-radius:9px;color:#dbeaff;font-size:10px;font-weight:800}.unbound-health-item span:last-child{text-transform:uppercase}.unbound-health-item[data-state="green"] span:last-child{color:#7CFF8A}.unbound-health-item[data-state="yellow"] span:last-child{color:#ffe36e}.unbound-health-item[data-state="red"] span:last-child{color:#ff8d8d}
      @media(max-width:760px){.unbound-health-bar{width:100%;margin:0 0 8px}.unbound-health-main{padding:8px 9px}.unbound-health-message{display:none}.unbound-health-details{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);
  }

  function mount() {
    if (document.getElementById(BAR_ID)) return document.getElementById(BAR_ID);
    const shell = document.querySelector('.chat-shell');
    if (!shell || !shell.parentNode) return null;
    const bar = document.createElement('section');
    bar.id = BAR_ID;
    bar.className = 'unbound-health-bar';
    bar.dataset.state = 'checking';
    bar.innerHTML = `
      <button class="unbound-health-main" type="button" aria-expanded="false" aria-controls="${DETAILS_ID}">
        <span class="unbound-health-left"><span class="unbound-health-dot"></span><span class="unbound-health-title">SYSTEM HEALTH: CHECKING</span><span class="unbound-health-message">Running server diagnostics…</span></span>
        <span class="unbound-health-time">checking</span>
      </button>
      <div id="${DETAILS_ID}" class="unbound-health-details" hidden></div>`;
    shell.parentNode.insertBefore(bar, shell);
    const button = bar.querySelector('.unbound-health-main');
    const details = bar.querySelector('.unbound-health-details');
    button.addEventListener('click', () => {
      const open = details.hidden;
      details.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    });
    return bar;
  }

  function componentLabel(name) {
    return ({ server:'Server', hardware:'Hardware', network:'Network', database:'Database', ai:'AI', selfHeal:'Self-heal' })[name] || name;
  }

  function updateTopStatus(state) {
    const top = document.querySelector('.status');
    if (!top) return;
    const mapped = state === 'green' ? 'online' : state === 'yellow' ? 'maintenance' : 'degraded';
    top.dataset.state = mapped;
    top.innerHTML = `<span class="status-dot"></span>${state === 'green' ? 'SYSTEMS HEALTHY' : state === 'yellow' ? 'SYSTEM WARNING' : 'SYSTEM ISSUE'}`;
  }

  function render(payload) {
    const bar = mount();
    if (!bar) return;
    const state = ['green','yellow','red'].includes(payload?.overall) ? payload.overall : 'red';
    bar.dataset.state = state;
    const title = bar.querySelector('.unbound-health-title');
    const message = bar.querySelector('.unbound-health-message');
    const time = bar.querySelector('.unbound-health-time');
    const details = bar.querySelector('.unbound-health-details');
    title.textContent = `SYSTEM HEALTH: ${state.toUpperCase()}`;
    message.textContent = payload?.message || (state === 'green' ? 'All monitored systems are healthy.' : 'Health check requires attention.');
    const checked = payload?.checkedAt ? new Date(payload.checkedAt) : new Date();
    time.textContent = checked.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
    const components = payload?.components || {};
    details.replaceChildren();
    for (const name of ['server','hardware','network','database','ai','selfHeal']) {
      const component = components[name];
      if (!component) continue;
      const item = document.createElement('div');
      const componentState = ['green','yellow','red'].includes(component.status) ? component.status : 'yellow';
      item.className = 'unbound-health-item';
      item.dataset.state = componentState;
      const label = document.createElement('span');
      label.textContent = componentLabel(name);
      const value = document.createElement('span');
      value.textContent = componentState;
      item.append(label, value);
      details.appendChild(item);
    }
    updateTopStatus(state);
  }

  async function refresh() {
    try {
      const response = await fetch(ENDPOINT, { method:'GET', cache:'no-store', headers:{ Accept:'application/json' } });
      const payload = await response.json();
      render(payload);
    } catch (_) {
      render({ overall:'red', message:'UNBOUND AI cannot reach its internal diagnostic service.', checkedAt:new Date().toISOString(), components:{} });
    }
  }

  function boot() {
    injectStyles();
    mount();
    void refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
    window.addEventListener('beforeunload', () => window.clearInterval(timer), { once:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
