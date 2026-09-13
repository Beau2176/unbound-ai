function integrateNativeShellServerSource(source) {
  const input = String(source || "");
  if (
    input.includes('app.get("/desktop-voice-input.js"') &&
    input.includes('app.get("/native-mobile-bridge.js"') &&
    input.includes('app.get("/voice-presets.js"') &&
    input.includes('desktop-voice-input.js?v=102') &&
    input.includes('native-mobile-bridge.js?v=102') &&
    input.includes('voice-presets.js?v=108') &&
    input.includes('injectVoiceListenControl')
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

  const block = `app.get("/desktop-voice-input.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "desktop-voice-input.js"));\n});\n\napp.get("/native-mobile-bridge.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "native-mobile-bridge.js"));\n});\n\napp.get("/voice-presets.js", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n  res.type("application/javascript");\n  return res.sendFile(path.join(__dirname, "voice-presets.js"));\n});\n\napp.use((req, res, next) => {\n  if (req.path !== "/" && req.path !== "/index.html") return next();\n\n  try {\n    const homepagePath = path.join(__dirname, "index.html");\n    const homepage = require("fs").readFileSync(homepagePath, "utf8");\n    const bodyMarker = "</body>";\n    if (!homepage.includes(bodyMarker)) return next();\n\n    const { injectVoiceListenControl } = require("./ui/voice-listen");\n    const voiceHomepage = injectVoiceListenControl(homepage);\n    const bridgedHomepage = voiceHomepage.replace(\n      bodyMarker,\n      '  <script src="/desktop-voice-input.js?v=102" defer></script>\\n  <script src="/native-mobile-bridge.js?v=102" defer></script>\\n  <script src="/voice-presets.js?v=108" defer></script>\\n</body>'\n    );\n    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n    res.type("html");\n    return res.send(bridgedHomepage);\n  } catch (error) {\n    console.error("UNBOUND AI NATIVE SHELL HOMEPAGE ERROR:", error);\n    return next();\n  }\n});\n\n`;

  return input.slice(0, index) + block + input.slice(index);
}

module.exports = {
  integrateNativeShellServerSource
};
