(() => {
  'use strict';

  const BUTTON_ID = 'unboundInstallApp';
  const MESSAGE_ID = 'unboundInstallMessage';
  const STYLE_ID = 'unbound-install-app-v100';
  const MANIFEST_ID = 'unboundManifestLink';
  const MANIFEST_URL = '/manifest.webmanifest?v=100';
  const SERVICE_WORKER_URL = '/unbound-sw.js?v=100';

  let deferredInstallPrompt = null;

  function isStandalone() {
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.matchMedia?.('(display-mode: fullscreen)')?.matches ||
      window.navigator.standalone === true
    );
  }

  function isIosSafariLike() {
    const ua = String(navigator.userAgent || '');
    const isiOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const webkit = /WebKit/i.test(ua);
    const excluded = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
    return isiOS && webkit && !excluded;
  }

  function canRegisterServiceWorker() {
    const host = String(location.hostname || '').toLowerCase();
    return Boolean(
      'serviceWorker' in navigator &&
      (window.isSecureContext || host === 'localhost' || host === '127.0.0.1' || host === '::1')
    );
  }

  function ensureManifest() {
    let link = document.getElementById(MANIFEST_ID);
    if (!link) {
      link = document.createElement('link');
      link.id = MANIFEST_ID;
      link.rel = 'manifest';
      link.href = MANIFEST_URL;
      link.crossOrigin = 'use-credentials';
      document.head.appendChild(link);
    }
    return link;
  }

  function ensureMobileMetadata() {
    const values = [
      ['apple-mobile-web-app-capable', 'yes'],
      ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
      ['apple-mobile-web-app-title', 'UNBOUND']
    ];
    for (const [name, content] of values) {
      let meta = document.head.querySelector(`meta[name="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = name;
        document.head.appendChild(meta);
      }
      meta.content = content;
    }

    let touchIcon = document.head.querySelector('link[rel="apple-touch-icon"]');
    if (!touchIcon) {
      touchIcon = document.createElement('link');
      touchIcon.rel = 'apple-touch-icon';
      touchIcon.href = '/unbound-cosmic.png';
      document.head.appendChild(touchIcon);
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.unbound-install-btn{min-height:36px;padding:8px 12px;border-radius:10px;border:1px solid rgba(101,232,164,.38);background:rgba(19,91,59,.18);color:#baf8d7;cursor:pointer;font:inherit;font-size:12px;font-weight:850;letter-spacing:.03em;white-space:nowrap;}',
      '.unbound-install-btn:hover{background:rgba(19,91,59,.3);border-color:rgba(101,232,164,.68);}',
      '.unbound-install-btn[hidden]{display:none!important;}',
      '.unbound-install-message{position:fixed;z-index:120;right:16px;top:78px;width:min(360px,calc(100vw - 32px));padding:14px;border:1px solid rgba(107,193,255,.35);border-radius:14px;background:rgba(4,10,21,.97);box-shadow:0 18px 55px rgba(0,0,0,.55);color:#eef9ff;font-size:12px;line-height:1.5;}',
      '.unbound-install-message strong{display:block;margin-bottom:5px;color:#fff;}',
      '.unbound-install-message button{margin-top:10px;padding:7px 10px;border-radius:9px;border:1px solid rgba(107,193,255,.34);background:rgba(66,165,255,.12);color:#e7f5ff;font:inherit;font-weight:800;cursor:pointer;}',
      '@media(max-width:760px){.unbound-install-btn{width:34px;min-width:34px;min-height:34px;padding:6px;font-size:0}.unbound-install-btn::after{content:"⬇";font-size:16px;line-height:1}.unbound-install-message{top:66px;right:10px;width:calc(100vw - 20px)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function mountTarget() {
    return document.querySelector('.topbar-right, .top-actions, .auth-actions, .topbar');
  }

  function closeMessage() {
    document.getElementById(MESSAGE_ID)?.remove();
  }

  function showMessage(title, body) {
    closeMessage();
    const box = document.createElement('div');
    box.id = MESSAGE_ID;
    box.className = 'unbound-install-message';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-live', 'polite');
    const heading = document.createElement('strong');
    heading.textContent = title;
    const copy = document.createElement('div');
    copy.textContent = body;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', closeMessage);
    box.append(heading, copy, close);
    document.body.appendChild(box);
  }

  function setButtonVisibility() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    if (isStandalone()) {
      button.hidden = true;
      closeMessage();
      return;
    }
    button.hidden = !(deferredInstallPrompt || isIosSafariLike());
  }

  async function requestInstall() {
    if (isStandalone()) {
      setButtonVisibility();
      return;
    }

    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice?.outcome === 'accepted') {
          showMessage('Installing UNBOUND AI', 'UNBOUND AI was accepted for installation. Your browser will finish adding it to this device.');
        } else {
          showMessage('Install canceled', 'Nothing changed. You can tap Install App again whenever the browser offers installation.');
        }
      } catch (_) {
        showMessage('Install unavailable', 'The browser could not open its install prompt. Use the browser menu and choose Install app or Add to Home screen.');
      }
      setButtonVisibility();
      return;
    }

    if (isIosSafariLike()) {
      showMessage('Add UNBOUND AI to Home Screen', 'In Safari, tap the Share button, then choose Add to Home Screen. UNBOUND AI will open in its own app-style window.');
    }
  }

  function mountButton() {
    if (document.getElementById(BUTTON_ID)) return true;
    const target = mountTarget();
    if (!target) return false;
    injectStyles();
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'unbound-install-btn';
    button.textContent = '⬇ Install App';
    button.hidden = true;
    button.setAttribute('aria-label', 'Install UNBOUND AI on this device');
    button.addEventListener('click', requestInstall);
    target.appendChild(button);
    setButtonVisibility();
    return true;
  }

  async function registerServiceWorker() {
    if (!canRegisterServiceWorker()) return;
    try {
      await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
        scope: '/',
        updateViaCache: 'none'
      });
    } catch (error) {
      console.warn('UNBOUND AI app install worker unavailable:', error?.name || 'service-worker-error');
    }
  }

  function boot() {
    ensureManifest();
    ensureMobileMetadata();
    void registerServiceWorker();
    if (mountButton()) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (mountButton() || attempts >= 40) window.clearInterval(timer);
    }, 125);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    setButtonVisibility();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setButtonVisibility();
    showMessage('UNBOUND AI installed', 'UNBOUND AI has been added to this device. You can launch it like an app from your home screen or app list.');
  });

  window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', setButtonVisibility);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
