const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");

// Exercise the real shell script with isolated PostgreSQL command doubles.
// These tests do not claim to prove that a real database can be restored.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "unbound-backup-test-"));
const bin = path.join(root, "bin");
const output = path.join(root, "backup files");
fs.mkdirSync(bin);
fs.mkdirSync(output);
function executable(name, body) {
  fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o700 });
}
executable("date", 'echo 20260913T120000Z');
executable("pg_dump", `
for arg in "$@"; do
  case "$arg" in --file=*) target="\${arg#--file=}" ;; esac
done
printf 'test archive content' > "$target"
if [[ "\${FAIL_DUMP:-0}" == 1 ]]; then exit 11; fi
if [[ "\${EMPTY_DUMP:-0}" == 1 ]]; then : > "$target"; fi`);
executable("pg_restore", 'if [[ "${FAIL_RESTORE:-0}" == 1 ]]; then exit 12; fi');
const script = path.join(__dirname, "backup-postgres.sh");
const baseEnv = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  BACKUP_DATABASE_URL: "postgresql://example:fake-test-password@invalid/test",
  BACKUP_DIR: output,
  BACKUP_PREFIX: "unbound-ai",
  BACKUP_RETENTION_DAYS: "14"
};
function run(extra = {}) {
  return spawnSync("bash", [script], { env: { ...baseEnv, ...extra }, encoding: "utf8" });
}
function entries() { return fs.readdirSync(output).sort(); }
function concurrentRun() {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [script], { env: baseEnv, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Backup exited ${code}`)));
  });
}
function oldFile(relative) {
  const name = path.join(output, relative);
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, "preserve unless an exact backup name");
  const old = new Date(Date.now() - 40 * 86400000);
  fs.utimesSync(name, old, old);
  return name;
}

(async () => {
  try {
    for (const prefix of ["../escape", "*", "x[ab]", "-option", "a/b", "a".repeat(65)]) {
      assert.equal(run({ BACKUP_PREFIX: prefix }).status, 4);
    }
    for (const days of ["0", "08", "-1", "1.5", "99999999999999999999", "$(false)"]) {
      assert.equal(run({ BACKUP_RETENTION_DAYS: days }).status, 4);
    }
    assert.equal(run({ BACKUP_DATABASE_URL: "", DATABASE_URL: "" }).status, 2);
    assert.deepEqual(entries(), []);

    for (const failure of ["FAIL_DUMP", "FAIL_RESTORE", "EMPTY_DUMP"]) {
      assert.notEqual(run({ [failure]: "1" }).status, 0);
      assert.deepEqual(entries(), [], "Failed backups must leave no published or staging files");
    }

    // A checksum-tool failure must also leave the output unchanged.
    executable("sha256sum", "exit 13");
    assert.notEqual(run().status, 0);
    assert.deepEqual(entries(), []);
    fs.unlinkSync(path.join(bin, "sha256sum"));

    await Promise.all([concurrentRun(), concurrentRun(), concurrentRun()]);
    const dumps = entries().filter(name => name.endsWith(".dump"));
    assert.equal(dumps.length, 3, "Same-second concurrent backups must remain distinct");
    assert.equal(entries().length, 6);
    for (const dump of dumps) {
      assert.equal(fs.statSync(path.join(output, dump)).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.join(output, `${dump}.sha256`)).mode & 0o777, 0o600);
      const check = spawnSync("sha256sum", ["-c", `${dump}.sha256`], { cwd: output });
      assert.equal(check.status, 0, "Published checksum must verify from the backup directory");
    }

    const legacy = oldFile("unbound-ai-20000101T000000Z.dump");
    const legacyHash = oldFile("unbound-ai-20000101T000000Z.dump.sha256");
    const modern = oldFile("unbound-ai-20000101T000000Z-abc123XY.dump");
    const keep = [
      oldFile("unbound-ai-important.dump"),
      oldFile("other-20000101T000000Z.dump"),
      oldFile("nested/unbound-ai-20000101T000000Z.dump"),
      oldFile("unbound-ai-20000101T000000Z.dump.partial")
    ];
    assert.notEqual(run({ FAIL_DUMP: "1" }).status, 0);
    assert(fs.existsSync(legacy), "Failure must not prune existing backups");
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert(!result.stdout.includes("fake-test-password"));
    for (const name of [legacy, legacyHash, modern]) assert(!fs.existsSync(name));
    for (const name of keep) assert(fs.existsSync(name));
    assert(!entries().some(name => name.startsWith(".unbound-backup.")));
    console.log("Backup contracts passed: concurrency, permissions, checksums, failures, input validation and bounded retention.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
