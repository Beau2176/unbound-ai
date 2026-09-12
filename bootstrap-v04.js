const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const root = __dirname;
const appDir = path.join(root, "app");
const payloadDir = path.join(root, ".deploy-v04");

const expected = {
  server: "a86b235f58e47f1ca24ca0423760b0f7d815f6f40489898cb2969a588aa07223",
  index: "2cea88a4579d9ff6e8e886a3c1d87a048d77f5bb1735421618601f934af6c5b7"
};

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function reconstruct(prefix, outputName) {
  const parts = fs.readdirSync(payloadDir)
    .filter((name) => new RegExp(`^${prefix}-\\d+\\.b64$`).test(name))
    .sort();

  if (!parts.length) {
    throw new Error(`UNBOUND v0.4 ${prefix} payload is missing.`);
  }

  const encoded = parts
    .map((name) => fs.readFileSync(path.join(payloadDir, name), "utf8").trim())
    .join("");

  fs.writeFileSync(path.join(appDir, outputName), Buffer.from(encoded, "base64"));
}

function applyPatchIfNeeded(fileName, patchName, targetHash = null, markers = []) {
  const file = path.join(appDir, fileName);
  if (targetHash && sha256(file) === targetHash) return;

  const current = fs.readFileSync(file, "utf8");
  if (markers.length && markers.every((marker) => current.includes(marker))) return;

  execFileSync(
    "patch",
    ["--batch", "--forward", "--fuzz=3", "-p1", "-i", path.join(payloadDir, patchName)],
    { cwd: root, stdio: "inherit" }
  );

  if (targetHash && sha256(file) !== targetHash) {
    throw new Error(`UNBOUND v0.4 integrity check failed for ${fileName}.`);
  }

  const updated = fs.readFileSync(file, "utf8");
  for (const marker of markers) {
    if (!updated.includes(marker)) {
      throw new Error(`UNBOUND v0.4 verification marker missing from ${fileName}: ${marker}`);
    }
  }
}

reconstruct("server", "server.generated.js");
if (sha256(path.join(appDir, "server.generated.js")) !== expected.server) {
  throw new Error("UNBOUND v0.4 integrity check failed for server.generated.js.");
}

applyPatchIfNeeded("index.html", "index.patch", expected.index);
applyPatchIfNeeded("admin.html", "admin.patch", null, [
  "Usage & Cost Metering",
  "Administrator Audit Log",
  "loadAudit()",
  "loadUsage()"
]);

console.log("UNBOUND AI v0.4 runtime payload verified.");

if (process.env.UNBOUND_BOOTSTRAP_VERIFY_ONLY === "true") {
  process.exit(0);
}

require(path.join(appDir, "server.generated.js"));
