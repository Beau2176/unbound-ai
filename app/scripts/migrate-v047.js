const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const serverPath = path.join(appRoot, "server.js");
const regressionPath = path.join(appRoot, "scripts", "regression-contract.js");
const securityPath = path.join(appRoot, "scripts", "security-contract.js");

function replaceOnce(source, needle, replacement, label) {
  const count = source.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return source.replace(needle, replacement);
}

let server = fs.readFileSync(serverPath, "utf8");
server = replaceOnce(
  server,
  `app.get("/admin.html", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "admin.html"));\n});`,
  `app.get("/admin.html", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "admin.html"));\n});\napp.get("/terms.html", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "terms.html"));\n});\napp.get("/privacy.html", (req, res) => {\n  res.setHeader("Cache-Control", "no-cache");\n  return res.sendFile(path.join(__dirname, "privacy.html"));\n});`,
  "explicit legal document routes"
);
fs.writeFileSync(serverPath, server);

let regression = fs.readFileSync(regressionPath, "utf8");
regression = replaceOnce(
  regression,
  `function testBrowserContracts() {\n  const indexHtml = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");\n  const adminHtml = fs.readFileSync(path.join(appRoot, "admin.html"), "utf8");`,
  `function testBrowserContracts() {\n  const indexHtml = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");\n  const adminHtml = fs.readFileSync(path.join(appRoot, "admin.html"), "utf8");\n  const termsHtml = fs.readFileSync(path.join(appRoot, "terms.html"), "utf8");\n  const privacyHtml = fs.readFileSync(path.join(appRoot, "privacy.html"), "utf8");`,
  "legal browser fixtures"
);
regression = replaceOnce(
  regression,
  `  forbidText(adminHtml.toLowerCase(), "bypass gate", "admin must not contain gate-bypass control");`,
  `  forbidText(adminHtml.toLowerCase(), "bypass gate", "admin must not contain gate-bypass control");\n\n  requireText(termsHtml, "DRAFT — NOT YET IN FORCE", "Terms draft warning");\n  requireText(privacyHtml, "DRAFT — NOT YET IN FORCE", "Privacy draft warning");\n  requireText(termsHtml, 'name="robots" content="noindex, nofollow"', "Terms noindex directive");\n  requireText(privacyHtml, 'name="robots" content="noindex, nofollow"', "Privacy noindex directive");\n  requireText(termsHtml, "Review required before launch", "Terms review warning");\n  requireText(privacyHtml, "Review required before launch", "Privacy review warning");`,
  "legal browser contracts"
);
fs.writeFileSync(regressionPath, regression);

let security = fs.readFileSync(securityPath, "utf8");
security = replaceOnce(
  security,
  `requireText(server, 'app.get("/admin.html"', "explicit admin route");`,
  `requireText(server, 'app.get("/admin.html"', "explicit admin route");\nrequireText(server, 'app.get("/terms.html"', "explicit Terms route");\nrequireText(server, 'app.get("/privacy.html"', "explicit Privacy route");`,
  "legal route security contracts"
);
fs.writeFileSync(securityPath, security);

console.log("Applied v0.47 draft legal page routes and contracts.");
