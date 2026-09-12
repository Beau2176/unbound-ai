const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walk(fullPath));
    else results.push(fullPath);
  }
  return results;
}

function checkJavaScriptFile(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: appRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`JavaScript syntax validation failed: ${path.relative(appRoot, filePath)}`);
  }
}

function checkInlineScripts(filePath) {
  const html = fs.readFileSync(filePath, "utf8");
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let checked = 0;
  while ((match = scriptPattern.exec(html))) {
    const attributes = String(match[1] || "");
    if (/\bsrc\s*=/.test(attributes)) continue;
    if (/\btype\s*=\s*["'](?:application|text)\/(?:json|ld\+json)["']/i.test(attributes)) continue;
    const code = String(match[2] || "").trim();
    if (!code) continue;
    new vm.Script(code, {
      filename: `${path.basename(filePath)}#inline-script-${checked + 1}`
    });
    checked += 1;
  }
  return checked;
}

const files = walk(appRoot);
const jsFiles = files.filter((filePath) => filePath.endsWith(".js"));
for (const filePath of jsFiles) checkJavaScriptFile(filePath);

let inlineScripts = 0;
for (const htmlName of ["index.html", "admin.html"]) {
  const filePath = path.join(appRoot, htmlName);
  if (fs.existsSync(filePath)) inlineScripts += checkInlineScripts(filePath);
}

console.log(`Validated ${jsFiles.length} JavaScript file(s) and ${inlineScripts} inline browser script(s).`);
