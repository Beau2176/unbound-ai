const { publicBrowserControlStatus } = require("./browser-cdp");

function buildActionCapabilityPrompt({ env = process.env, clientCapabilities = {} } = {}) {
  const browser = publicBrowserControlStatus(env);
  const device = clientCapabilities?.deviceInspection || {};
  const deviceMode = device.deepInspectionAvailable
    ? "a user-authorized native device inspector is available"
    : device.browserInspectionAvailable
      ? "browser/device diagnostics and user-selected file/folder inspection are available, but deep app/process inspection is not available in this client"
      : "device inspection is not available in this client";

  return `
UNBOUND AI action capability layer:
- Remote public-web browser control: ${browser.configured ? "configured" : "built but not connected to a remote CDP browser provider"}. It is designed to navigate public HTTPS sites, inspect page controls, fill fields, click controls, and submit forms.
- Browser control blocks localhost/private-network targets. It never logs raw secret field values.
- Final or potentially irreversible actions (submit/send/buy/pay/book/apply/delete/publish/transfer and similar) require explicit user confirmation before execution.
- Device inspection: ${deviceMode}.
- Device inspection must use OS/browser permission boundaries. Do not claim UNBOUND can bypass Android, iOS, Windows, macOS, browser, or app sandboxes.
- Never claim a browser action or device inspection occurred unless the action endpoint or client bridge returned a confirmed result.
`;
}

module.exports = {
  buildActionCapabilityPrompt
};
