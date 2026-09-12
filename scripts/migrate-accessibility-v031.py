from pathlib import Path


def one(path, old, new, label):
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    path.write_text(text.replace(old, new, 1))


index = Path("app/index.html")

one(
    index,
    '''    button {
      -webkit-tap-highlight-color: transparent;
    }

    .topbar {
''',
    '''    button {
      -webkit-tap-highlight-color: transparent;
    }

    :where(button, input, textarea, select, a[href], [tabindex]):focus-visible {
      outline: 3px solid #ffd297;
      outline-offset: 3px;
    }

    .skip-link {
      position: fixed;
      top: 10px;
      left: 10px;
      z-index: 1000;
      transform: translateY(-160%);
      padding: 10px 14px;
      border: 2px solid #ffd297;
      border-radius: 10px;
      background: #050913;
      color: #ffffff;
      font-weight: 900;
      text-decoration: none;
      transition: transform 0.15s ease;
    }

    .skip-link:focus {
      transform: translateY(0);
    }

    .topbar {
''',
    "focus and skip-link styles"
)

one(
    index,
    '''    .auth-submit.secondary {
      border-color: rgba(107, 193, 255, 0.24);
      background: rgba(66, 165, 255, 0.08);
      color: #d9efff;
    }
  </style>
''',
    '''    .auth-submit.secondary {
      border-color: rgba(107, 193, 255, 0.24);
      background: rgba(66, 165, 255, 0.08);
      color: #d9efff;
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        scroll-behavior: auto !important;
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }

      body {
        background-attachment: scroll;
      }
    }
  </style>
''',
    "reduced motion styles"
)

one(
    index,
    '''<body>
  <header class="topbar">
''',
    '''<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="topbar">
''',
    "skip link markup"
)

one(
    index,
    '''  <main class="page">
''',
    '''  <main id="main-content" class="page" tabindex="-1">
''',
    "main landmark target"
)

one(
    index,
    '''    let currentRecoveryCodes = [];

    function escapeHtml(value) {
''',
    '''    let currentRecoveryCodes = [];
    let modalReturnFocus = null;

    function rememberModalReturnFocus() {
      modalReturnFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }

    function modalFocusables(modal) {
      if (!modal) return [];
      return Array.from(
        modal.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hidden && element.getClientRects().length > 0);
    }

    function focusModal(modal, preferred = null) {
      window.requestAnimationFrame(() => {
        const target = preferred && !preferred.disabled
          ? preferred
          : modalFocusables(modal)[0];
        target?.focus();
      });
    }

    function restoreModalReturnFocus() {
      const target = modalReturnFocus;
      modalReturnFocus = null;
      if (target?.isConnected && typeof target.focus === "function") {
        window.requestAnimationFrame(() => target.focus());
      }
    }

    function activeModal() {
      return [deleteAccountModal, securityModal, accessModal, historyModal, authModal]
        .find((modal) => modal && !modal.hidden) || null;
    }

    function trapModalTabKey(event) {
      if (event.key !== "Tab") return false;
      const modal = activeModal();
      if (!modal) return false;
      const focusables = modalFocusables(modal);
      if (!focusables.length) {
        event.preventDefault();
        return true;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;

      if (event.shiftKey && (current === first || !modal.contains(current))) {
        event.preventDefault();
        last.focus();
        return true;
      }
      if (!event.shiftKey && (current === last || !modal.contains(current))) {
        event.preventDefault();
        first.focus();
        return true;
      }
      return false;
    }

    function escapeHtml(value) {
''',
    "modal focus helpers"
)

one(
    index,
    '''    async function openAccess() {
      if (!currentUser) { showToast("Sign in to view account access."); openAuth("login"); return; }
      accessFeedback.className = "auth-feedback"; accessFeedback.textContent = "";
      accessModal.hidden = false; document.body.classList.add("modal-open");
      await refreshAccountAccess({ silent: false });
      await loadLegalPolicyStatus();
    }

    function closeAccess() {
      accessModal.hidden = true;
      if (historyModal.hidden && authModal.hidden && securityModal.hidden && deleteAccountModal.hidden) document.body.classList.remove("modal-open");
    }
''',
    '''    async function openAccess() {
      if (!currentUser) { showToast("Sign in to view account access."); openAuth("login"); return; }
      rememberModalReturnFocus();
      accessFeedback.className = "auth-feedback"; accessFeedback.textContent = "";
      accessModal.hidden = false; document.body.classList.add("modal-open");
      focusModal(accessModal, accessCloseButton);
      await refreshAccountAccess({ silent: false });
      await loadLegalPolicyStatus();
    }

    function closeAccess() {
      accessModal.hidden = true;
      if (historyModal.hidden && authModal.hidden && securityModal.hidden && deleteAccountModal.hidden) document.body.classList.remove("modal-open");
      restoreModalReturnFocus();
    }
''',
    "access modal focus"
)

one(
    index,
    '''    async function openHistory() {
      if (!currentUser) {
        showToast("Sign in to use server-saved conversation history.");
        return;
      }

      historyModal.hidden = false;
      document.body.classList.add("modal-open");
      await loadHistoryList();
    }
''',
    '''    async function openHistory() {
      if (!currentUser) {
        showToast("Sign in to use server-saved conversation history.");
        return;
      }

      rememberModalReturnFocus();
      historyModal.hidden = false;
      document.body.classList.add("modal-open");
      focusModal(historyModal, historyCloseButton);
      await loadHistoryList();
    }
''',
    "history modal open focus"
)

one(
    index,
    '''    function closeHistory() {
      historyModal.hidden = true;
      if (authModal.hidden && accessModal.hidden && securityModal.hidden && deleteAccountModal.hidden) {
        document.body.classList.remove("modal-open");
      }
    }
''',
    '''    function closeHistory() {
      historyModal.hidden = true;
      if (authModal.hidden && accessModal.hidden && securityModal.hidden && deleteAccountModal.hidden) {
        document.body.classList.remove("modal-open");
      }
      restoreModalReturnFocus();
    }
''',
    "history modal close focus"
)

one(
    index,
    '''    function openAuth(mode = "login") {
      authModal.hidden = false;
      document.body.classList.add("modal-open");
      setAuthMode(mode);
    }

    function closeAuth() {
      authModal.hidden = true;
      if (historyModal.hidden && accessModal.hidden && deleteAccountModal.hidden) document.body.classList.remove("modal-open");
      clearAuthFeedback();
    }
''',
    '''    function openAuth(mode = "login") {
      rememberModalReturnFocus();
      authModal.hidden = false;
      document.body.classList.add("modal-open");
      setAuthMode(mode);
    }

    function closeAuth() {
      authModal.hidden = true;
      if (historyModal.hidden && accessModal.hidden && deleteAccountModal.hidden) document.body.classList.remove("modal-open");
      clearAuthFeedback();
      restoreModalReturnFocus();
    }
''',
    "auth modal focus"
)

one(
    index,
    '''    async function openSecurity() {
      if (!currentUser) return;
      passwordChangeForm.reset();
''',
    '''    async function openSecurity() {
      if (!currentUser) return;
      rememberModalReturnFocus();
      passwordChangeForm.reset();
''',
    "security modal remember focus"
)

one(
    index,
    '''      securityModal.hidden = false;
      document.body.classList.add("modal-open");
      try {
''',
    '''      securityModal.hidden = false;
      document.body.classList.add("modal-open");
      focusModal(securityModal, securityCloseButton);
      try {
''',
    "security modal initial focus"
)

one(
    index,
    '''      if (authModal.hidden && historyModal.hidden && accessModal.hidden && deleteAccountModal.hidden) {
        document.body.classList.remove("modal-open");
      }
    }

    async function handlePasswordChange(event) {
''',
    '''      if (authModal.hidden && historyModal.hidden && accessModal.hidden && deleteAccountModal.hidden) {
        document.body.classList.remove("modal-open");
      }
      restoreModalReturnFocus();
    }

    async function handlePasswordChange(event) {
''',
    "security modal return focus"
)

one(
    index,
    '''    function openDeleteAccount() {
      if (!currentUser || currentUser.role === "admin") {
        showToast("Account deletion is not available for this account here.");
        return;
      }

      deleteAccountForm.reset();
''',
    '''    function openDeleteAccount() {
      if (!currentUser || currentUser.role === "admin") {
        showToast("Account deletion is not available for this account here.");
        return;
      }

      rememberModalReturnFocus();
      deleteAccountForm.reset();
''',
    "delete modal remember focus"
)

one(
    index,
    '''      if (authModal.hidden && historyModal.hidden && accessModal.hidden && securityModal.hidden) {
        document.body.classList.remove("modal-open");
      }
    }

    function setDeleteAccountBusy(isBusy) {
''',
    '''      if (authModal.hidden && historyModal.hidden && accessModal.hidden && securityModal.hidden) {
        document.body.classList.remove("modal-open");
      }
      restoreModalReturnFocus();
    }

    function setDeleteAccountBusy(isBusy) {
''',
    "delete modal return focus"
)

one(
    index,
    '''    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!securityModal.hidden) {
''',
    '''    document.addEventListener("keydown", (event) => {
      if (trapModalTabKey(event)) return;
      if (event.key !== "Escape") return;
      if (!securityModal.hidden) {
''',
    "modal tab trap"
)

print("Applied UNBOUND AI v0.31 accessibility hardening.")
