const MOBILE_LAYOUT_STYLE_ID = "unbound-mobile-layout-v092";

const MOBILE_LAYOUT_STYLES = `<style id="${MOBILE_LAYOUT_STYLE_ID}">
@media (max-width: 760px) {
  html,
  body {
    max-width: 100%;
    overflow-x: hidden;
  }

  .topbar {
    position: sticky;
    top: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 8px 10px 7px;
  }

  .brand {
    width: 100%;
    min-width: 0;
  }

  .mark {
    width: 30px;
    height: 30px;
    flex: 0 0 30px;
  }

  .brand-copy {
    min-width: 0;
  }

  .brand-name {
    font-size: 13px;
    letter-spacing: .16em;
    white-space: nowrap;
  }

  .tagline,
  .status {
    display: none !important;
  }

  .topbar-right {
    display: flex !important;
    width: 100%;
    max-width: 100%;
    gap: 6px !important;
    flex-wrap: nowrap !important;
    align-items: center;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 1px 0 3px;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .topbar-right::-webkit-scrollbar {
    display: none;
  }

  .topbar-right > * {
    flex: 0 0 auto;
  }

  .topbar-right .account-button,
  .topbar-right .logout-button {
    min-height: 34px;
    padding: 7px 10px;
    font-size: 10px;
    white-space: nowrap;
  }

  .auth-actions,
  .user-menu {
    flex: 0 0 auto;
    flex-wrap: nowrap !important;
  }

  .auth-actions,
  .user-menu {
    order: -1;
  }

  .user-pill {
    min-width: 38px;
    flex: 0 0 auto;
    padding: 4px;
  }

  .user-meta {
    display: none !important;
  }

  .page {
    width: calc(100% - 16px);
    padding-top: clamp(96px, 16vh, 150px);
    padding-bottom: 22px;
  }

  .chat-shell {
    width: 100%;
    max-width: 100%;
    border-radius: 18px;
    overflow: hidden;
  }

  .chat-head {
    display: block;
    padding: 16px 14px 13px;
  }

  .chat-head > div:first-child {
    width: 100%;
    max-width: none;
    min-width: 0;
    flex: none;
  }

  .chat-head h1 {
    margin: 0;
    max-width: 14ch;
    font-size: clamp(25px, 8vw, 34px);
    line-height: 1.04;
  }

  .chat-head p {
    max-width: 34ch;
    margin-top: 10px;
    font-size: 13px;
    line-height: 1.45;
  }

  .chat-actions {
    width: 100%;
    max-width: 100%;
    margin-top: 14px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
    align-items: stretch;
    flex: none;
  }

  .product-control {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
    max-width: 100%;
    gap: 6px;
    padding: 6px;
    box-sizing: border-box;
  }

  .product-button {
    width: 100%;
    min-width: 0;
    padding: 8px 5px;
    text-align: center;
    white-space: nowrap;
    font-size: 10px;
  }

  .depth-control {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    max-width: 100%;
  }

  .depth-button {
    width: 100%;
    min-width: 0;
    text-align: center;
  }

  .style-control {
    grid-column: 1 / -1;
    display: flex;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .style-control select {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    max-width: none;
  }

  .age {
    display: none !important;
  }

  #historyButton {
    grid-column: 1;
  }

  #newChatButton {
    grid-column: 2;
  }

  #historyButton[hidden] + #newChatButton {
    grid-column: 1 / -1;
  }

  .new-chat {
    width: 100%;
    min-width: 0;
  }

  .messages {
    min-height: 140px;
    max-height: 48vh;
    padding: 14px 12px 8px;
  }

  .message {
    max-width: 94%;
    overflow-wrap: anywhere;
  }

  .composer-wrap {
    padding: 10px;
  }

  .composer {
    min-width: 0;
    max-width: 100%;
  }

  .composer textarea {
    min-width: 0;
    font-size: 16px;
  }

  .footer-line {
    padding: 8px 12px 12px;
    font-size: 10px;
  }
}

@media (max-width: 430px) {
  .page {
    width: calc(100% - 12px);
    padding-top: clamp(78px, 13vh, 120px);
  }

  .chat-head h1 {
    max-width: 12ch;
    font-size: clamp(24px, 8vw, 30px);
  }

  .topbar-right .account-button,
  .topbar-right .logout-button {
    padding: 7px 9px;
  }
}

@media (max-width: 360px) {
  .product-control {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>`;

function injectMobileLayoutStyles(html) {
  const source = String(html || "");
  if (source.includes(`id="${MOBILE_LAYOUT_STYLE_ID}"`)) {
    return source;
  }

  const marker = "</head>";
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first === -1 || first !== last) {
    const error = new Error("UNBOUND AI mobile layout head marker is missing or ambiguous.");
    error.code = "MOBILE_LAYOUT_HEAD_MARKER_INVALID";
    throw error;
  }

  return source.slice(0, first) + `  ${MOBILE_LAYOUT_STYLES}\n` + source.slice(first);
}

module.exports = {
  MOBILE_LAYOUT_STYLE_ID,
  MOBILE_LAYOUT_STYLES,
  injectMobileLayoutStyles
};
