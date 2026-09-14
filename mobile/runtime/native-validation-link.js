(() => {
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

  const localNativeBundle =
    String(location.hostname || '').toLowerCase() === 'localhost' &&
    (location.protocol === 'https:' || location.protocol === 'capacitor:');
  if (!localNativeBundle) return;

  const install = () => {
    if (document.getElementById('unboundNativeValidationLink')) return;
    const target = document.querySelector('.topbar-right');
    if (!target) return;

    const link = document.createElement('a');
    link.id = 'unboundNativeValidationLink';
    link.className = 'account-button native-validation-link';
    link.href = './native-validation.html';
    link.textContent = 'Native Check';
    link.setAttribute('aria-label', 'Open native device validation');
    target.appendChild(link);
  };

  install();
  if (!document.getElementById('unboundNativeValidationLink')) {
    window.addEventListener('DOMContentLoaded', install, { once: true });
  }
})();
