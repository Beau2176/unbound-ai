const os = require("os");
const fs = require("fs");
const dns = require("dns").promises;
const net = require("net");
const path = require("path");

const DIAGNOSTIC_POLICY = Object.freeze({
  version: "v1.0",
  intervalMs: 30000,
  networkTimeoutMs: 2500,
  eventLoopSampleMs: 40,
  defaultProbeHost: "api.openai.com"
});

const SEVERITY = Object.freeze({ green: 0, yellow: 1, red: 2 });

function statusFromRatio(value, yellowAt, redAt) {
  if (!Number.isFinite(value)) return "yellow";
  if (value >= redAt) return "red";
  if (value >= yellowAt) return "yellow";
  return "green";
}

function worstStatus(values) {
  let worst = "green";
  for (const value of values) {
    const status = SEVERITY[value] === undefined ? "yellow" : value;
    if (SEVERITY[status] > SEVERITY[worst]) worst = status;
  }
  return worst;
}

function safeProbeHost(env = process.env) {
  const configured = String(env.UNBOUND_DIAGNOSTIC_HOST || "").trim().toLowerCase();
  const candidate = configured || DIAGNOSTIC_POLICY.defaultProbeHost;
  return /^[a-z0-9.-]+$/.test(candidate) && !candidate.startsWith(".") ? candidate : DIAGNOSTIC_POLICY.defaultProbeHost;
}

function hardwareSnapshot(rootDir = path.resolve(__dirname, "..")) {
  const cpus = os.cpus() || [];
  const cpuCount = Math.max(cpus.length, 1);
  const load1 = Number((os.loadavg() || [0])[0] || 0);
  const loadRatio = load1 / cpuCount;
  const totalMemory = Number(os.totalmem() || 0);
  const freeMemory = Number(os.freemem() || 0);
  const usedMemoryRatio = totalMemory > 0 ? 1 - freeMemory / totalMemory : 0;
  const processMemory = process.memoryUsage();
  const heapRatio = processMemory.heapTotal > 0 ? processMemory.heapUsed / processMemory.heapTotal : 0;

  let disk = { available: false, freeRatio: null, status: "yellow" };
  try {
    if (typeof fs.statfsSync === "function") {
      const stat = fs.statfsSync(rootDir);
      const blocks = Number(stat.blocks || 0);
      const availableBlocks = Number(stat.bavail || stat.bfree || 0);
      const freeRatio = blocks > 0 ? availableBlocks / blocks : 0;
      disk = {
        available: true,
        freeRatio: Number(freeRatio.toFixed(4)),
        status: freeRatio <= 0.03 ? "red" : freeRatio <= 0.10 ? "yellow" : "green"
      };
    }
  } catch (_) {}

  const cpuStatus = statusFromRatio(loadRatio, 0.85, 1.50);
  const memoryStatus = usedMemoryRatio >= 0.95 || heapRatio >= 0.97
    ? "red"
    : usedMemoryRatio >= 0.88 || heapRatio >= 0.90
      ? "yellow"
      : "green";

  return {
    status: worstStatus([cpuStatus, memoryStatus, disk.status]),
    cpu: {
      status: cpuStatus,
      logicalCores: cpuCount,
      load1: Number(load1.toFixed(2)),
      normalizedLoad: Number(loadRatio.toFixed(3))
    },
    memory: {
      status: memoryStatus,
      systemUsedPercent: Number((usedMemoryRatio * 100).toFixed(1)),
      processRssMb: Number((processMemory.rss / 1048576).toFixed(1)),
      heapUsedPercent: Number((heapRatio * 100).toFixed(1))
    },
    disk
  };
}

function eventLoopProbe(sampleMs = DIAGNOSTIC_POLICY.eventLoopSampleMs) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    setTimeout(() => {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      const lagMs = Math.max(0, elapsedMs - sampleMs);
      resolve({
        lagMs: Number(lagMs.toFixed(1)),
        status: lagMs >= 500 ? "red" : lagMs >= 150 ? "yellow" : "green"
      });
    }, sampleMs);
  });
}

function tcpProbe(host, port = 443, timeoutMs = DIAGNOSTIC_POLICY.networkTimeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (ok, error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - started, error: error ? String(error.message || error) : null });
    };
    socket.setTimeout(timeoutMs, () => finish(false, "timeout"));
    socket.once("connect", () => finish(true));
    socket.once("error", (error) => finish(false, error));
  });
}

async function networkSnapshot(host = safeProbeHost()) {
  const interfaces = os.networkInterfaces() || {};
  let activeInterfaces = 0;
  for (const entries of Object.values(interfaces)) {
    if (!Array.isArray(entries)) continue;
    if (entries.some((item) => item && !item.internal)) activeInterfaces += 1;
  }

  const started = Date.now();
  let dnsResult = { ok: false, latencyMs: null, error: null };
  try {
    await Promise.race([
      dns.lookup(host),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DIAGNOSTIC_POLICY.networkTimeoutMs))
    ]);
    dnsResult = { ok: true, latencyMs: Date.now() - started, error: null };
  } catch (error) {
    dnsResult = { ok: false, latencyMs: Date.now() - started, error: String(error?.message || error) };
  }

  const tcp = await tcpProbe(host);
  const status = dnsResult.ok && tcp.ok ? "green" : dnsResult.ok || tcp.ok ? "yellow" : "red";
  return {
    status,
    activeInterfaces,
    probeHost: host,
    dns: dnsResult,
    tcp443: tcp
  };
}

async function runDiagnostics({ rootDir, stateProvider = () => ({}) } = {}) {
  const state = stateProvider() || {};
  const [eventLoop, network] = await Promise.all([
    eventLoopProbe(),
    networkSnapshot()
  ]);
  const hardware = hardwareSnapshot(rootDir);

  const serverStatus = state.shuttingDown ? "red" : eventLoop.status;
  const databaseStatus = state.databaseConfigured
    ? state.databaseReady ? "green" : "red"
    : "red";
  const aiStatus = state.aiStatus?.configured ? "green" : "yellow";
  const selfHealStatus = state.selfHeal?.restartScheduled
    ? "red"
    : state.selfHeal?.locked
      ? "green"
      : "yellow";

  const components = {
    server: {
      status: serverStatus,
      uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
      eventLoopLagMs: eventLoop.lagMs,
      shuttingDown: Boolean(state.shuttingDown)
    },
    hardware,
    network,
    database: {
      status: databaseStatus,
      configured: Boolean(state.databaseConfigured),
      ready: Boolean(state.databaseReady),
      error: state.databaseError ? String(state.databaseError).slice(0, 160) : null
    },
    ai: {
      status: aiStatus,
      configured: Boolean(state.aiStatus?.configured),
      provider: state.aiStatus?.provider || null,
      model: state.aiStatus?.model || null
    },
    selfHeal: {
      status: selfHealStatus,
      locked: Boolean(state.selfHeal?.locked),
      repairs: Number(state.selfHeal?.repairs || 0),
      restartScheduled: Boolean(state.selfHeal?.restartScheduled)
    }
  };

  const overall = worstStatus(Object.values(components).map((component) => component.status));
  return {
    version: DIAGNOSTIC_POLICY.version,
    overall,
    message: overall === "green"
      ? "All monitored systems are healthy."
      : overall === "yellow"
        ? "UNBOUND AI is operating with a warning."
        : "UNBOUND AI detected a system problem.",
    checkedAt: new Date().toISOString(),
    components
  };
}

function createDiagnosticsMonitor({
  rootDir = path.resolve(__dirname, ".."),
  stateProvider = () => ({}),
  intervalMs = DIAGNOSTIC_POLICY.intervalMs,
  logger = console
} = {}) {
  let snapshot = null;
  let timer = null;
  let inFlight = null;

  const refresh = async () => {
    if (inFlight) return inFlight;
    inFlight = runDiagnostics({ rootDir, stateProvider })
      .then((next) => {
        snapshot = next;
        if (next.overall !== "green") logger.warn(`[UNBOUND DIAGNOSTICS] Health is ${next.overall}.`);
        return next;
      })
      .catch((error) => {
        const failed = {
          version: DIAGNOSTIC_POLICY.version,
          overall: "red",
          message: "Diagnostics failed to complete.",
          checkedAt: new Date().toISOString(),
          error: String(error?.message || error).slice(0, 200),
          components: {}
        };
        snapshot = failed;
        logger.error("[UNBOUND DIAGNOSTICS] Diagnostic cycle failed:", error);
        return failed;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };

  return Object.freeze({
    start() {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
      timer.unref?.();
    },
    async getSnapshot({ force = false } = {}) {
      if (force || !snapshot) return refresh();
      return snapshot;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  });
}

module.exports = {
  DIAGNOSTIC_POLICY,
  hardwareSnapshot,
  networkSnapshot,
  runDiagnostics,
  createDiagnosticsMonitor,
  worstStatus
};
