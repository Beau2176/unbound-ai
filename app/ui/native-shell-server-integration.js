function integrateNativeShellServerSource(source) {
  const input = String(source || "");
  if (
    input.includes('app.get("/desktop-voice-input.js"') &&
    input.includes('app.get("/native-mobile-bridge.js"') &&
    input.includes('app.get("/voice-presets.js"') &&
    input.includes('app.get("/continuous-voice.js"') &&
    input.includes('app.get("/install-app.js"') &&
    input.includes('app.get("/manifest.webmanifest"') &&
    input.includes('app.get("/unbound-sw.js"') &&
    input.includes('app.get("/unbound-app-icon.svg"') &&
    input.includes('app.get("/health-status.js"') &&
    input.includes('app.get("/runtime-capabilities.js"') &&
    input.includes('app.get("/device-inspector.js"') &&
    input.includes('app.get("/action-bridge.js"') &&
    input.includes('app.get("/tier-controls.js"') &&
    input.includes('app.get("/media-capture.js"') &&
    input.includes('app.get("/voice-media-shortcuts.js"') &&
    input.includes('app.get("/adult-step-up.js"') &&
    input.includes('desktop-voice-input.js?v=121') &&
    input.includes('voice-presets.js?v=109') &&
    input.includes('continuous-voice.js?v=099') &&
    input.includes('install-app.js?v=100') &&
    input.includes('manifest.webmanifest?v=100') &&
    input.includes('tier-controls.js?v=20260914') &&
    input.includes('media-capture.js?v=20260914') &&
    input.includes('voice-media-shortcuts.js?v=20260914') &&
    input.includes('adult-step-up.js?v=095') &&
    input.includes('health-status.js?v=121') &&
    input.includes('runtime-capabilities.js?v=121') &&
    input.includes('injectMobileLayoutStyles') &&
    input.includes('injectVoiceListenControl') &&
    input.includes('injectInterruptedStreamRecovery')
  ) return input;

  const middlewareMarker = 'app.use("/api", createMaintenanceMiddleware());';
  const legacyIndexMarker = 'app.get("/index.html", (req, res) => {';
  let index = input.indexOf(middlewareMarker);
  if (index === -1) index = input.indexOf(legacyIndexMarker);
  if (index === -1) {
    const error = new Error("UNBOUND AI native shell integration anchor is missing.");
    error.code = "NATIVE_SHELL_INDEX_MARKER_INVALID";
    throw error;
  }

  const block = `app.get("/desktop-voice-input.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "desktop-voice-input.js"));\n});\n\napp.get("/native-mobile-bridge.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "native-mobile-bridge.js"));\n});\n\napp.get("/voice-presets.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "voice-presets.js"));\n});\n\napp.get("/continuous-voice.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "continuous-voice.js"));\n});\n\napp.get("/install-app.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "install-app.js"));\n});\n\napp.get("/manifest.webmanifest", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, must-revalidate");\n  res.type("application/manifest+json");\n  return res.sendFile(path.join(__dirname, "manifest.webmanifest"));\n});\n\napp.get("/unbound-sw.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.setHeader("Service-Worker-Allowed", "/");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "unbound-sw.js"));\n});\n\napp.get("/unbound-app-icon.svg", (req, res) => {\n  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");\n  res.type("image/svg+xml");\n  return res.sendFile(path.join(__dirname, "unbound-app-icon.svg"));\n});\n\napp.get("/health-status.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "health-status.js"));\n});\n\napp.get("/runtime-capabilities.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "runtime-capabilities.js"));\n});\n\napp.get("/device-inspector.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "device-inspector.js"));\n});\n\napp.get("/action-bridge.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "action-bridge.js"));\n});\n\napp.get("/tier-controls.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "tier-controls.js"));\n});\n\napp.get("/media-capture.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "media-capture.js"));\n});\n\napp.get("/voice-media-shortcuts.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "voice-media-shortcuts.js"));\n});\n\napp.get("/adult-step-up.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "adult-step-up.js"));\n});\n\napp.use((req, res, next) => {\n  if (req.path !== "/" && req.path !== "/index.html") return next();\n\n  try {\n    const homepagePath = path.join(__dirname, "index.html");\n    const homepage = require("fs").readFileSync(homepagePath, "utf8");\n    const bodyMarker = "</body>";\n    const headMarker = "</head>";\n    if (!homepage.includes(bodyMarker) || !homepage.includes(headMarker)) return next();\n\n    const { injectMobileLayoutStyles } = require("./ui/mobile-layout");\n    const { injectVoiceListenControl } = require("./ui/voice-listen");\n    const { injectInterruptedStreamRecovery } = require("./ui/chat-stream-recovery");\n    const mobileHomepage = injectMobileLayoutStyles(homepage);\n    const voiceHomepage = injectVoiceListenControl(mobileHomepage);\n    const recoveredHomepage = injectInterruptedStreamRecovery(voiceHomepage);\n    const installableHomepage = recoveredHomepage.replace(\n      headMarker,\n      '  <link rel="manifest" href="/manifest.webmanifest?v=100" crossorigin="use-credentials" />\\n  <link rel="apple-touch-icon" href="/unbound-cosmic.png" />\\n  <meta name="apple-mobile-web-app-capable" content="yes" />\\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />\\n  <meta name="apple-mobile-web-app-title" content="UNBOUND" />\\n</head>'\n    );\n    const bridgedHomepage = installableHomepage.replace(\n      bodyMarker,\n      '  <script src="/desktop-voice-input.js?v=121" defer></script>\\n  <script src="/native-mobile-bridge.js?v=102" defer></script>\\n  <script src="/voice-presets.js?v=109" defer></script>\\n  <script src="/continuous-voice.js?v=099" defer></script>\\n  <script src="/install-app.js?v=100" defer></script>\\n  <script src="/health-status.js?v=121" defer></script>\\n  <script src="/runtime-capabilities.js?v=121" defer></script>\\n  <script src="/device-inspector.js?v=120" defer></script>\\n  <script src="/action-bridge.js?v=120" defer></script>\\n  <script src="/tier-controls.js?v=20260914" defer></script>\\n  <script src="/media-capture.js?v=20260914" defer></script>\\n  <script src="/voice-media-shortcuts.js?v=20260914" defer></script>\\n  <script src="/adult-step-up.js?v=095" defer></script>\\n</body>'\n    );\n    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n    res.type("html");\n    return res.send(bridgedHomepage);\n  } catch (error) {\n    console.error("UNBOUND AI NATIVE SHELL HOMEPAGE ERROR:", error);\n    return next();\n  }\n});\n\n`;

  return input.slice(0, index) + block + input.slice(index);
}

module.exports = {
  integrateNativeShellServerSource
};
