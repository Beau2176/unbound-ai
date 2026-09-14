const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  LOCKED_POLICY,
  captureBaseline,
  verifyAndRepairBaseline
} = require("../ops/self-heal");

assert.strictEqual(LOCKED_POLICY.enabled, true);
assert.strictEqual(LOCKED_POLICY.allowRuntimeDisable, false);
assert.strictEqual(LOCKED_POLICY.autonomousSourceMutation, false);
assert.strictEqual(
  LOCKED_POLICY.repairStrategy,
  "restore-known-good-and-restart"
);
assert.ok(LOCKED_POLICY.criticalFiles.includes("ops/self-heal.js"));
assert.ok(LOCKED_POLICY.criticalFiles.includes("start.js"));
assert.ok(LOCKED_POLICY.criticalFiles.includes("security/http-security.js"));
assert.ok(LOCKED_POLICY.criticalFiles.includes("knowledge/adaptive.js"));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "unbound-self-heal-"));
try {
  const target = path.join(tempRoot, "critical.js");
  fs.writeFileSync(target, "module.exports = 'known-good';\n");
  const baseline = captureBaseline({
    rootDir: tempRoot,
    criticalFiles: ["critical.js"],
    makeFilesReadOnly: false
  });

  fs.writeFileSync(target, "module.exports = 'tampered';\n");
  const result = verifyAndRepairBaseline(baseline, {
    makeFilesReadOnly: false
  });

  assert.deepStrictEqual(result.drifted, ["critical.js"]);
  assert.deepStrictEqual(result.repaired, ["critical.js"]);
  assert.deepStrictEqual(result.failed, []);
  assert.strictEqual(
    fs.readFileSync(target, "utf8"),
    "module.exports = 'known-good';\n"
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("UNBOUND self-heal contract passed.");
