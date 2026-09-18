const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const CODE_EXTS = new Set([
  ".js", ".mjs", ".ts", ".java", ".html", ".css", ".sh",
  ".gradle", ".pro", ".xml", ".yml", ".yaml", ".json"
]);
const PRIMARY_EXCLUDES = [
  /^mobile\/www\//,
  /^mobile\/plugins\/device-inspector\/dist\//,
  /package-lock\.json$/
];
const IMPLEMENTATION_EXCLUDES = [
  /package-lock\.json$/
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

function rel(full) {
  return path.relative(ROOT, full).split(path.sep).join("/");
}

function logicalLines(text) {
  if (!text.length) return 0;
  const parts = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return parts.length - (parts[parts.length - 1] === "" ? 1 : 0);
}

function nonblankLines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
    .filter(line => line.trim().length > 0).length;
}

function isImplementationFile(file) {
  const p = rel(file);
  const ext = path.extname(p).toLowerCase();
  return CODE_EXTS.has(ext) || p === "unbound";
}

function excluded(p, rules) {
  return rules.some(re => re.test(p));
}

function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf.includes(0)) return null;
  return buf.toString("utf8");
}

function summarize(files) {
  let physical = 0;
  let nonblank = 0;
  const byExt = {};
  for (const file of files) {
    const text = readText(file);
    if (text === null) continue;
    const p = rel(file);
    const ext = path.extname(p).toLowerCase() || "(none)";
    const lines = logicalLines(text);
    const nb = nonblankLines(text);
    physical += lines;
    nonblank += nb;
    if (!byExt[ext]) byExt[ext] = { files: 0, physical: 0, nonblank: 0 };
    byExt[ext].files += 1;
    byExt[ext].physical += lines;
    byExt[ext].nonblank += nb;
  }
  return { files: files.length, physical, nonblank, byExt };
}

const all = walk(ROOT);
const implementation = all.filter(isImplementationFile);
const primary = implementation.filter(file => !excluded(rel(file), PRIMARY_EXCLUDES));
const implementationAll = implementation.filter(file => !excluded(rel(file), IMPLEMENTATION_EXCLUDES));
const textFiles = all.filter(file => readText(file) !== null);

const report = {
  commitExpected: process.env.GITHUB_SHA || null,
  primarySource: summarize(primary),
  implementationIncludingGenerated: summarize(implementationAll),
  allTrackedText: summarize(textFiles),
  exclusions: {
    primary: PRIMARY_EXCLUDES.map(String),
    implementation: IMPLEMENTATION_EXCLUDES.map(String)
  }
};

console.log("UNBOUND_EXACT_LOC_REPORT=" + JSON.stringify(report));
