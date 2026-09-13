function integrateNativeShellServerSource(source) {
  const input = String(source || "");
  if (
    input.includes('native-mobile-bridge.js') &&
    input.includes('desktop-voice-input.js?v=100') &&
    input.includes('injectVoiceListenControl')
  ) return input;

  const marker = 'app.use("/api", createMaintenanceMiddleware());';
  const index = input.indexOf(marker);
  if (index === -1) {
    const error = new Error("UNBOUND AI native shell middleware anchor is missing.");
    error.code = "NATIVE_SHELL_MIDDLEWARE_ANCHOR_MISSING";
    throw error;
  }

  const block = `app.use((req, res, next) => {\n  if (req.path !== "/" && req.path !== "/index.html") return next();\n\n  try {\n    const homepagePath = path.join(__dirname, "index.html");\n    const homepage = require("fs").readFileSync(homepagePath, "utf8");\n    const bodyMarker = "</body>";\n    if (!homepage.includes(bodyMarker)) return next();\n\n    const { injectVoiceListenControl } = require("./ui/voice-listen");\n    const voiceHomepage = injectVoiceListenControl(homepage);\n    const bridgedHomepage = voiceHomepage.replace(\n      bodyMarker,\n      '  <script src="/desktop-voice-input.js?v=100" defer></script>\\n  <script src="/native-mobile-bridge.js" defer></script>\\n</body>'\n    );\n    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");\n    res.type("html");\n    return res.send(bridgedHomepage);\n  } catch (error) {\n    console.error("UNBOUND AI NATIVE SHELL HOMEPAGE ERROR:", error);\n    return next();\n  }\n});\n\n`;

  return input.slice(0, index) + block + input.slice(index);
}

module.exports = {
  integrateNativeShellServerSource
};
