function integrateNativeShellServerSource(source) {
  const input = String(source || "");
  if (input.includes('native-mobile-bridge.js')) return input;

  const marker = 'app.get("/index.html", (req, res) => {';
  const index = input.indexOf(marker);
  if (index === -1 || index !== input.lastIndexOf(marker)) {
    const error = new Error("UNBOUND AI native shell index route marker is missing or ambiguous.");
    error.code = "NATIVE_SHELL_INDEX_MARKER_INVALID";
    throw error;
  }

  const block = `app.use((req, res, next) => {\n  if (req.path !== "/" && req.path !== "/index.html") return next();\n\n  try {\n    const homepagePath = path.join(__dirname, "index.html");\n    const homepage = require("fs").readFileSync(homepagePath, "utf8");\n    const bodyMarker = "</body>";\n    if (!homepage.includes(bodyMarker)) return next();\n\n    const bridgedHomepage = homepage.replace(\n      bodyMarker,\n      '  <script src="/native-mobile-bridge.js" defer></script>\\n</body>'\n    );\n    res.setHeader("Cache-Control", "no-cache");\n    res.type("html");\n    return res.send(bridgedHomepage);\n  } catch (error) {\n    console.error("UNBOUND AI NATIVE SHELL HOMEPAGE ERROR:", error);\n    return next();\n  }\n});\n\n`;

  return input.slice(0, index) + block + input.slice(index);
}

module.exports = {
  integrateNativeShellServerSource
};
