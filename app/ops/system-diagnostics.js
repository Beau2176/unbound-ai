const os = require("os");
const fs = require("fs");
const dns = require("dns").promises;
const net = require("net");
const path = require("path");

const DIAGNOSTIC_POLICY = Object.freeze({
  version: "v1.3",
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
  return /^[a-z0-9.-]+$/.test(candidate) && !candidate.startsWith(".")
    ? candidate
    : DIAGNOSTIC_POLICY.defaultProbeHost;
}

function readFiniteNumber(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (!text || text === "max") return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch (_) {
    return null;
  }
}

function cgroupMemorySnapshot() {
  const candidates = [
    {
      source: "cgroup-v2",
      current: "/sys/fs/cgroup/memory.current",
      limit: "/sys/fs/cgroup/memory.max"
    },
    {
      source: "cgroup-v1",
      current: "/sys/fs/cgroup/memory/memory.usage_in_bytes",
      limit: "/sys/fs/cgroup/memory/memory.limit_in_bytes"
    }
  ];

  for (const item of candidates) {
    const usedBytes = readFiniteNumber(item.current);
    const limitBytes = readFiniteNumber(item.limit);
    if (
      Number.isFinite(usedBytes) &&
      Number.isFinite(limitBytes) &&
      limitBytes > 0 &&
      limitBytes < Number.MAX_SAFE_INTEGER
    ) {
      return {
        available: true,
        source: item.source,
        usedBytes,
        limitBytes,
        usedRatio: Math.min(Math.max(usedBytes / limitBytes, 0), 1)
      };
    }
  }

  return {
    available: false,
    source: "process-heap",
    usedBytes: null,
    limitBytes: null,
    usedRatio: null
  };
}

function hardwareSnapshot(rootDir = path.resolve(__dirname, "..")) {
  const cpus = os.cpus() || [];
  const cpuCount = Math.max(cpus.length, 1);
  const load1 = Number((os.loadavg() || [0])[0] || 0);
  const loadRatio = load1 / cpuCount;
  const processMemory = process.memoryUsage();
  const heapRatio = processMemory.heapTotal > 0
    ? processMemory.heapUsed / processMemory.heapTotal
    : 0;
  const cgroup = cgroupMemorySnapshot();

  // On hosted/container platforms os.totalmem()/freemem() can describe the host,
  // not this service. Use cgroup memory when available, otherwise the Node heap.
  const memoryRatio = cgroup.available ? cgroup.usedRatio : heapRatio;
  const memoryStatus = memoryRatio >= 0.95
    ? "red"
    : memoryRatio >= 0.88
      ? "yellow"
      : "green";

  // Host load averages are not reliable container CPU telemetry. Event-loop lag
  // is monitored separately and is a much better signal of whether UNBOUND is
  // actually CPU-starved. Keep host load informational when cgroups are present.
  const cpuStatus = cgroup.available
    ? "green"
    : statusFromRatio(loadRatio, 0.85, 1.50);

  let disk = {
    available: false,
    freeRatio: null,
    status: "green",
    summary: "Disk telemetry unavailable; no disk failure detected."
  };
  try {
    if (typeof fs.statfsSync === "function") {
      const stat = fs.statfsSync(rootDir);
      const blocks = Number(stat.blocks || 0);
      const availableBlocks = Number(stat.bavail || stat.bfree || 0);
      const freeRatio = blocks > 0 ? availableBlocks / blocks : 1;
      const status = freeRatio <= 0.03 ? "red" : freeRatio <= 0.10 ? "yellow" : "green";
      disk = {
        available: true,
        freeRatio: Number(freeRatio.toFixed(4)),
        status,
        summary: `Disk free ${Math.round(freeRatio * 100)}%.`
      };
    }
  } catch (_) {}

  const status = worstStatus([cpuStatus, memoryStatus, disk.status]);
  const memoryPercent = Number((memoryRatio * 100).toFixed(1));
  const summaryParts = [];
  if (memoryStatus !== "green") summaryParts.push(`memory ${memoryPercent}% (${cgroup.source})`);
  if (disk.status !== "green") summaryParts.push(disk.summary);
  if (cpuStatus !== "green") summaryParts.push(`host load ${Number(loadRatio.toFixed(2))} per core`);

  return {
    status,
    summary: summaryParts.length ? summaryParts.join("; ") : "Container resources are healthy.",
    cpu: {
      status: cpuStatus,
      logicalCores: cpuCount,
      load1: Number(load1.toFixed(2)),
      normalizedLoad: Number(loadRatio.toFixed(3)),
      source: cgroup.available ? "host-load-informational" : "host-load"
    },
    memory: {
      status: memoryStatus,
      source: cgroup.source,
      usedPercent: memoryPercent,
      processRssMb: Number((processMemory.rss / 1048576).toFixed(1)),
      heapUsedPercent: Number((heapRatio * 100).toFixed(1)),
      limitMb: cgroup.limitBytes ? Number((cgroup.limitBytes / 1048576).toFixed(1)) : null
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
      resolve({
        ok,
        latencyMs: Date.now() - started,
        error: error ? String(error.message || error) : null
      });
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
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), DIAGNOSTIC_POLICY.networkTimeoutMs)
      )
    ]);
    dnsResult = { ok: true, latencyMs: Date.now() - started, error: null };
  } catch (error) {
    dnsResult = {
      ok: false,
      latencyMs: Date.now() - started,
      error: String(error?.message || error)
    };
  }

  const tcp = await tcpProbe(host);
  const status = dnsResult.ok && tcp.ok
    ? "green"
    : dnsResult.ok || tcp.ok
      ? "yellow"
      : "red";
  const summary = status === "green"
    ? `DNS and outbound HTTPS connectivity to ${host} are healthy.`
    : `Network probe warning: DNS ${dnsResult.ok ? "ok" : "failed"}; HTTPS ${tcp.ok ? "ok" : "failed"}.`;

  return {
    status,
    summary,
    activeInterfaces,
    probeHost: host,
    dns: dnsResult,
    tcp443: tcp
  };
}

function aiDiagnosticSnapshot(value = {}) {
  const ai = value && typeof value === "object" ? value : {};
  const configured = Boolean(ai.configured);
  const circuitState = String(ai?.circuitBreaker?.state || "disabled");
  const circuitDegraded = circuitState === "open" || circuitState === "half-open";
  const fallbackProvider = ai.fallbackProvider || null;
  const provider = ai.provider || null;
  const primaryBulkhead = provider && ai.bulkheads?.[provider]
    ? ai.bulkheads[provider]
    : null;
  const capacityDegraded = Boolean(
    primaryBulkhead &&
    Number(primaryBulkhead.maxConcurrent || 0) > 0 &&
    Number(primaryBulkhead.active || 0) >= Number(primaryBulkhead.maxConcurrent || 0)
  );
  const status = configured
    ? (circuitDegraded || capacityDegraded ? "yellow" : "green")
    : "yellow";

  let summary;
  if (!configured) {
    summary = "AI provider is not fully configured.";
  } else if (circuitState === "open") {
    summary = fallbackProvider
      ? `Primary AI provider is temporarily bypassed; fallback ${fallbackProvider} is active.`
      : "Primary AI provider circuit is open.";
  } else if (circuitState === "half-open") {
    summary = fallbackProvider
      ? `Primary AI provider is being recovery-tested while fallback ${fallbackProvider} remains available.`
      : "Primary AI provider is being recovery-tested.";
  } else if (capacityDegraded) {
    summary = Number(primaryBulkhead.queued || 0) > 0
      ? `Primary AI provider is at its configured concurrency limit with ${Number(primaryBulkhead.queued)} queued request(s).`
      : "Primary AI provider is at its configured concurrency limit.";
  } else {
    summary = "AI provider is configured.";
  }

  return {
    status,
    summary,
    configured,
    provider,
    model: ai.model || null,
    failoverEnabled: Boolean(ai.failoverEnabled),
    fallbackProvider,
    circuitBreaker: ai.circuitBreaker || null,
    telemetry: ai.telemetry || null,
    bulkheads: ai.bulkheads || null
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
  const selfHealStatus = state.selfHeal?.restartScheduled
    ? "red"
    : state.selfHeal?.locked
      ? "green"
      : "yellow";

  const components = {
    server: {
      status: serverStatus,
      summary: state.shuttingDown
        ? "Server shutdown is in progress."
        : eventLoop.status === "green"
          ? "Server event loop is responsive."
          : `Server event-loop lag is ${eventLoop.lagMs} ms.`,
      uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
      eventLoopLagMs: eventLoop.lagMs,
      shuttingDown: Boolean(state.shuttingDown)
    },
    hardware,
    network,
    database: {
      status: databaseStatus,
      summary: databaseStatus === "green"
        ? "Database connection is ready."
        : state.databaseConfigured
          ? "Database is configured but not ready."
          : "Database is not configured.",
      configured: Boolean(state.databaseConfigured),
      ready: Boolean(state.databaseReady),
      error: state.databaseError ? String(state.databaseError).slice(0, 160) : null
    },
    ai: aiDiagnosticSnapshot(state.aiStatus),
    selfHeal: {
      status: selfHealStatus,
      summary: selfHealStatus === "green"
        ? "Self-heal supervisor is locked and active."
        : selfHealStatus === "red"
          ? "Self-heal has scheduled a restart."
          : "Self-heal supervisor has not finished arming yet.",
      locked: Boolean(state.selfHeal?.locked),
      repairs: Number(state.selfHeal?.repairs || 0),
      restartScheduled: Boolean(state.selfHeal?.restartScheduled)
    }
  };

  const overall = worstStatus(Object.values(components).map((component) => component.status));
  const unhealthy = Object.entries(components)
    .filter(([, component]) => component.status !== "green")
    .map(([name, component]) => `${name}: ${component.summary}`);

  return {
    version: DIAGNOSTIC_POLICY.version,
    overall,
    message: overall === "green"
      ? "All monitored systems are healthy."
      : overall === "yellow"
        ? `UNBOUND AI is operating with a warning${unhealthy.length ? ` — ${unhealthy.join(" | ")}` : "."}`
        : `UNBOUND AI detected a system problem${unhealthy.length ? ` — ${unhealthy.join(" | ")}` : "."}`,
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
        if (next.overall !== "green") {
          const details = Object.entries(next.components || {})
            .filter(([, component]) => component?.status !== "green")
            .map(([name, component]) => `${name}=${component?.status}:${component?.summary || "no summary"}`)
            .join(" | ");
          logger.warn(`[UNBOUND DIAGNOSTICS] Health is ${next.overall}. ${details}`);
        }
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
  cgroupMemorySnapshot,
  hardwareSnapshot,
  networkSnapshot,
  aiDiagnosticSnapshot,
  runDiagnostics,
  createDiagnosticsMonitor,
  worstStatus
};
