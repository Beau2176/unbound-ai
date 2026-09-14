const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");

const LOCKED_POLICY = Object.freeze({
  version: "v1.2",
  enabled: true,
  allowRuntimeDisable: false,
  autonomousSourceMutation: false,
  repairStrategy: "restore-known-good-and-restart",
  intervalMs: 30000,
  startupGraceMs: 45000,
  healthTimeoutMs: 3500,
  consecutiveHealthFailuresBeforeRestart: 3,
  criticalFiles: Object.freeze([
    "start.js",
    "server.js",
    "ops/self-heal.js",
    "ops/system-diagnostics.js",
    "ops/diagnostics-server-integration.js",
    "capabilities/runtime.js",
    "capabilities/server-integration.js",
    "ui/native-shell-server-integration.js",
    "health-status.js",
    "runtime-capabilities.js",
    "project/identity.js",
    "security/http-security.js",
    "memory/server-integration.js",
    "knowledge/adaptive.js",
    "knowledge/server-integration.js",
    "voice/server-integration.js",
    "voice-presets.js"
  ])
});

let activeSupervisor = null;

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function safeTarget(rootDir, relativePath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(root, String(relativePath || ""));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Self-heal path escapes application root: ${relativePath}`);
  }
  return target;
}

function makeReadOnly(filePath) {
  try {
    fs.chmodSync(filePath, 0o444);
    return true;
  } catch (_) {
    return false;
  }
}

function captureBaseline({
  rootDir = path.resolve(__dirname, ".."),
  criticalFiles = LOCKED_POLICY.criticalFiles,
  makeFilesReadOnly = true
} = {}) {
  const entries = [];
  for (const relativePath of criticalFiles) {
    const filePath = safeTarget(rootDir, relativePath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Self-heal critical file is missing at startup: ${relativePath}`);
    }
    const content = fs.readFileSync(filePath);
    entries.push({
      relativePath,
      filePath,
      content,
      hash: sha256(content)
    });
    if (makeFilesReadOnly) makeReadOnly(filePath);
  }
  return Object.freeze({
    createdAt: new Date().toISOString(),
    rootDir: path.resolve(rootDir),
    entries: Object.freeze(entries)
  });
}

function atomicRestore(entry, { makeFilesReadOnly = true } = {}) {
  const directory = path.dirname(entry.filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(entry.filePath)}.unbound-repair-${process.pid}-${Date.now()}`
  );
  fs.mkdirSync(directory, { recursive: true });
  try { fs.chmodSync(entry.filePath, 0o644); } catch (_) {}
  fs.writeFileSync(tempPath, entry.content, { mode: 0o600 });
  fs.renameSync(tempPath, entry.filePath);
  if (makeFilesReadOnly) makeReadOnly(entry.filePath);
}

function verifyAndRepairBaseline(baseline, { makeFilesReadOnly = true } = {}) {
  const drifted = [];
  const repaired = [];
  const failed = [];

  for (const entry of baseline.entries) {
    let currentHash = null;
    try {
      if (fs.existsSync(entry.filePath)) {
        currentHash = sha256(fs.readFileSync(entry.filePath));
      }
    } catch (_) {}

    if (currentHash === entry.hash) {
      if (makeFilesReadOnly) makeReadOnly(entry.filePath);
      continue;
    }

    drifted.push(entry.relativePath);
    try {
      atomicRestore(entry, { makeFilesReadOnly });
      const restoredHash = sha256(fs.readFileSync(entry.filePath));
      if (restoredHash !== entry.hash) {
        throw new Error("restored hash mismatch");
      }
      repaired.push(entry.relativePath);
    } catch (error) {
      failed.push({
        file: entry.relativePath,
        error: String(error?.message || error)
      });
    }
  }

  return {
    ok: drifted.length === 0,
    drifted,
    repaired,
    failed
  };
}

function localHealthCheck(port, timeoutMs = LOCKED_POLICY.healthTimeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const request = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/healthz",
        timeout: timeoutMs,
        headers: { "User-Agent": "UNBOUND-Self-Heal/1.0" }
      },
      (response) => {
        response.resume();
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          statusCode: response.statusCode,
          latencyMs: Date.now() - startedAt
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("health-check-timeout")));
    request.on("error", (error) => {
      resolve({
        ok: false,
        statusCode: null,
        latencyMs: Date.now() - startedAt,
        error: String(error?.message || error)
      });
    });
  });
}

function startSelfHealingSupervisor({
  rootDir = path.resolve(__dirname, ".."),
  port = Number(process.env.PORT || 3000),
  logger = console
} = {}) {
  if (activeSupervisor) return activeSupervisor;

  const baseline = captureBaseline({ rootDir });
  const state = {
    version: LOCKED_POLICY.version,
    locked: true,
    startedAt: new Date().toISOString(),
    lastCheckAt: null,
    lastHealthyAt: null,
    lastRepairAt: null,
    lastRepairReason: null,
    consecutiveHealthFailures: 0,
    repairs: 0,
    restartScheduled: false,
    checking: false
  };
  let interval = null;
  let startupTimer = null;
  let stopped = false;

  function scheduleRestart(reason, code = 70) {
    if (state.restartScheduled || stopped) return;
    state.restartScheduled = true;
    state.lastRepairReason = reason;
    logger.error(`[UNBOUND SELF-HEAL] Restart scheduled: ${reason}`);
    setTimeout(() => process.exit(code), 350);
  }

  async function runCheck() {
    if (stopped || state.checking) return;
    state.checking = true;
    state.lastCheckAt = new Date().toISOString();

    try {
      const integrity = verifyAndRepairBaseline(baseline);
      if (integrity.drifted.length) {
        state.repairs += integrity.repaired.length;
        state.lastRepairAt = new Date().toISOString();
        state.lastRepairReason = integrity.failed.length
          ? "critical-file-repair-failed"
          : "critical-file-restored";
        logger.error(
          `[UNBOUND SELF-HEAL] Critical file drift detected. Restored: ${integrity.repaired.join(", ") || "none"}. Failed: ${integrity.failed.map((item) => item.file).join(", ") || "none"}.`
        );
        scheduleRestart(state.lastRepairReason, integrity.failed.length ? 78 : 70);
        return;
      }

      const health = await localHealthCheck(port);
      if (health.ok) {
        state.consecutiveHealthFailures = 0;
        state.lastHealthyAt = new Date().toISOString();
        return;
      }

      state.consecutiveHealthFailures += 1;
      logger.warn(
        `[UNBOUND SELF-HEAL] Local liveness check failed (${state.consecutiveHealthFailures}/${LOCKED_POLICY.consecutiveHealthFailuresBeforeRestart}): ${health.error || health.statusCode || "unknown"}`
      );
      if (
        state.consecutiveHealthFailures >=
        LOCKED_POLICY.consecutiveHealthFailuresBeforeRestart
      ) {
        scheduleRestart("repeated-local-liveness-failure", 70);
      }
    } catch (error) {
      logger.error("[UNBOUND SELF-HEAL] Supervisor check failed:", error);
      scheduleRestart("supervisor-check-failure", 70);
    } finally {
      state.checking = false;
    }
  }

  startupTimer = setTimeout(() => {
    void runCheck();
    interval = setInterval(() => void runCheck(), LOCKED_POLICY.intervalMs);
    interval.unref?.();
  }, LOCKED_POLICY.startupGraceMs);
  startupTimer.unref?.();

  activeSupervisor = Object.freeze({
    policy: LOCKED_POLICY,
    baseline,
    snapshot() {
      return {
        ...state,
        criticalFiles: baseline.entries.map((entry) => entry.relativePath)
      };
    },
    stopForShutdown() {
      stopped = true;
      if (startupTimer) clearTimeout(startupTimer);
      if (interval) clearInterval(interval);
    }
  });

  logger.log(
    `[UNBOUND SELF-HEAL] Locked supervisor ${LOCKED_POLICY.version} armed for ${baseline.entries.length} critical files.`
  );
  return activeSupervisor;
}

function getSelfHealSupervisor() {
  return activeSupervisor;
}

module.exports = {
  LOCKED_POLICY,
  sha256,
  captureBaseline,
  verifyAndRepairBaseline,
  localHealthCheck,
  startSelfHealingSupervisor,
  getSelfHealSupervisor
};
