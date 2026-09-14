(() => {
  "use strict";

  const GRID_ID = "unboundVoiceMediaShortcuts";
  const STYLE_ID = "unbound-voice-media-shortcuts-style";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .voice-listen-wrap.voice-listen-has-shortcuts {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
        width: min(286px, 100%);
        max-width: 100%;
      }
      .voice-listen-wrap.voice-listen-has-shortcuts > .voice-listen-button {
        width: 100%;
      }
      .unbound-voice-media-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        width: 100%;
      }
      .unbound-voice-media-shortcut {
        min-width: 0;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 0 10px;
        border: 1px solid rgba(255, 176, 74, .66);
        border-radius: 13px;
        background: linear-gradient(135deg, rgba(66, 165, 255, .14), rgba(255, 173, 67, .09));
        color: #f7fbff;
        font: 800 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        white-space: nowrap;
      }
      .unbound-voice-media-shortcut:hover,
      .unbound-voice-media-shortcut:focus-visible {
        border-color: rgba(91, 183, 255, .82);
        background: linear-gradient(135deg, rgba(66, 165, 255, .22), rgba(255, 173, 67, .14));
        outline: none;
      }
      .unbound-voice-media-shortcut .shortcut-icon {
        font-size: 18px;
        line-height: 1;
        flex: 0 0 auto;
      }
      @media (max-width: 760px) {
        .voice-listen-wrap.voice-listen-has-shortcuts {
          width: min(100%, 320px);
        }
        .unbound-voice-media-shortcut {
          min-height: 46px;
          font-size: 12px;
          padding: 0 8px;
        }
      }
      @media (max-width: 430px) {
        .voice-listen-wrap.voice-listen-has-shortcuts > .voice-listen-button {
          width: 100%;
          min-height: 46px;
          padding: 0 10px;
          font-size: 12px;
        }
        .voice-listen-wrap.voice-listen-has-shortcuts > .voice-listen-button::before {
          content: none;
        }
        .unbound-voice-media-grid { gap: 7px; }
        .unbound-voice-media-shortcut { font-size: 11px; }
      }
    `;
    document.head.appendChild(style);
  }

  function runExistingControl(id, unavailableMessage) {
    const control = document.getElementById(id);
    if (control && typeof control.click === "function") {
      control.click();
      return;
    }
    const textarea = document.querySelector("#message, .composer textarea, textarea[name='message'], textarea");
    if (textarea) {
      textarea.focus();
      textarea.title = unavailableMessage;
    }
  }

  function makeShortcut({ id, icon, label, title, onClick }) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = "unbound-voice-media-shortcut";
    button.title = title;
    button.setAttribute("aria-label", title);

    const iconNode = document.createElement("span");
    iconNode.className = "shortcut-icon";
    iconNode.setAttribute("aria-hidden", "true");
    iconNode.textContent = icon;

    const labelNode = document.createElement("span");
    labelNode.textContent = label;

    button.append(iconNode, labelNode);
    button.addEventListener("click", onClick);
    return button;
  }

  function hideLegacyMediaButtons() {
    const legacy = document.getElementById("unboundMediaActions");
    if (legacy) {
      legacy.hidden = true;
      legacy.setAttribute("aria-hidden", "true");
    }
  }

  function mount() {
    injectStyles();
    hideLegacyMediaButtons();
    if (document.getElementById(GRID_ID)) return;

    const voiceButton = document.getElementById("unboundVoiceListenButton");
    if (!voiceButton) return;
    const wrap = voiceButton.closest(".voice-listen-wrap") || voiceButton.parentElement;
    if (!wrap) return;

    wrap.classList.add("voice-listen-has-shortcuts");

    const grid = document.createElement("div");
    grid.id = GRID_ID;
    grid.className = "unbound-voice-media-grid";
    grid.setAttribute("aria-label", "Camera, photo, video, and file tools");

    grid.append(
      makeShortcut({
        id: "unboundVoiceCameraShortcut",
        icon: "📷",
        label: "Camera",
        title: "Open the camera to take a photo for UNBOUND AI",
        onClick: () => runExistingControl("unboundPhotoButton", "Camera capture is not ready on this device yet.")
      }),
      makeShortcut({
        id: "unboundVoicePhotosShortcut",
        icon: "🖼️",
        label: "Photos",
        title: "Choose an existing photo for analysis",
        onClick: () => { window.location.href = "/images.html"; }
      }),
      makeShortcut({
        id: "unboundVoiceVideoShortcut",
        icon: "🎥",
        label: "Video",
        title: "Record a video for visual analysis",
        onClick: () => runExistingControl("unboundVideoButton", "Video recording is not ready on this device yet.")
      }),
      makeShortcut({
        id: "unboundVoiceFilesShortcut",
        icon: "📄",
        label: "Files",
        title: "Choose a document or data file for analysis",
        onClick: () => { window.location.href = "/files.html"; }
      })
    );

    wrap.appendChild(grid);
    hideLegacyMediaButtons();
  }

  function initialize() {
    mount();
    const observer = new MutationObserver(() => {
      mount();
      hideLegacyMediaButtons();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
