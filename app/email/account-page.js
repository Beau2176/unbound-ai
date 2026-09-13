const fs = require("fs/promises");
const path = require("path");
const { injectModelRoutingUi } = require("../ai/model-routing-ui");
const { injectConnectedAppsUi } = require("../connections/ui");
const { injectMobileLayoutStyles } = require("../ui/mobile-layout");

const INDEX_PATH = path.join(__dirname, "..", "index.html");
const ACCOUNT_UI_PATH = path.join(__dirname, "account-ui.js");
const ACCOUNT_UI_SCRIPT = '<script src="/email-account-ui.js" defer></script>';

function injectEmailAccountUi(html) {
  const rawSource = String(html || "");
  const marker = "</body>";
  const firstIndex = rawSource.indexOf(marker);
  const lastIndex = rawSource.lastIndexOf(marker);

  if (firstIndex === -1 || firstIndex !== lastIndex) {
    const error = new Error("UNBOUND AI account page body marker is missing or ambiguous.");
    error.code = "EMAIL_ACCOUNT_UI_BODY_MARKER_INVALID";
    throw error;
  }

  if (rawSource.includes(ACCOUNT_UI_SCRIPT)) {
    const error = new Error("UNBOUND AI email account UI script is already injected.");
    error.code = "EMAIL_ACCOUNT_UI_ALREADY_INJECTED";
    throw error;
  }

  const modelAwareSource = rawSource.includes('id="modelProfileSelect"')
    ? rawSource
    : injectModelRoutingUi(rawSource);
  const connectedSource = injectConnectedAppsUi(modelAwareSource);
  const source = injectMobileLayoutStyles(connectedSource);
  const bodyIndex = source.indexOf(marker);
  return source.slice(0, bodyIndex) + `  ${ACCOUNT_UI_SCRIPT}\n` + source.slice(bodyIndex);
}

async function sendAccountIndexPage(_req, res) {
  try {
    const source = await fs.readFile(INDEX_PATH, "utf8");
    const html = injectEmailAccountUi(source);
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (error) {
    console.error("UNBOUND AI ACCOUNT PAGE INJECTION ERROR:", error?.message || error);
    return res.status(500).type("text/plain").send("UNBOUND AI could not load the account interface.");
  }
}

function sendEmailAccountUiScript(_req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(ACCOUNT_UI_PATH);
}

module.exports = {
  ACCOUNT_UI_SCRIPT,
  injectEmailAccountUi,
  sendAccountIndexPage,
  sendEmailAccountUiScript
};
