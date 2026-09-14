const express = require("express");
const path = require("path");
const { generateChat, getGatewayStatus } = require("../ai/gateway");
const { publicBrowserControlStatus } = require("./browser-cdp");
const {
  startBrowserTask,
  confirmBrowserTask,
  cancelBrowserTask
} = require("./browser-agent");

function cleanDeviceSnapshot(value) {
  const input = value && typeof value === "object" ? value : {};
  const cleanList = (list, max = 80) => (Array.isArray(list) ? list : [])
    .slice(0, max)
    .map((item) => ({
      name: String(item?.name || item?.label || "").slice(0, 160),
      id: String(item?.id || item?.packageName || item?.processName || "").slice(0, 220)
    }))
    .filter((item) => item.name || item.id);

  return {
    source: String(input.source || "browser").slice(0, 40),
    platform: String(input.platform || "").slice(0, 80),
    permissionGranted: Boolean(input.permissionGranted),
    system: input.system && typeof input.system === "object" ? {
      osVersion: String(input.system.osVersion || "").slice(0, 100),
      cpuCores: Number(input.system.cpuCores) || null,
      memoryTotalMb: Number(input.system.memoryTotalMb) || null,
      memoryAvailableMb: Number(input.system.memoryAvailableMb) || null,
      storageTotalMb: Number(input.system.storageTotalMb) || null,
      storageAvailableMb: Number(input.system.storageAvailableMb) || null,
      batteryPercent: Number(input.system.batteryPercent) || null,
      charging: Boolean(input.system.charging)
    } : null,
    apps: cleanList(input.apps, 100),
    processes: cleanList(input.processes, 100),
    selectedFiles: cleanList(input.selectedFiles, 100)
  };
}

async function analyzeDeviceSnapshot({ snapshot, question } = {}) {
  const gateway = getGatewayStatus();
  if (!gateway.configured) {
    const error = new Error("AI provider is not configured for device analysis.");
    error.code = "DEVICE_ANALYSIS_PROVIDER_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }
  const clean = cleanDeviceSnapshot(snapshot);
  const result = await generateChat({
    model: gateway.model,
    instructions: `
You are the device-diagnostics analyst inside UNBOUND AI.
Use only the user-authorized device snapshot provided to you.
Do not invent installed apps, processes, files, system data, malware findings, permissions, or access.
Do not request or expose passwords, authentication tokens, browser cookies, encryption keys, or other credentials.
If the snapshot is browser-limited rather than native, say so precisely.
Focus on troubleshooting, compatibility, performance, storage, network/device health, and explaining what is present.
`,
    input: [{
      role: "user",
      content: `Question:\n${String(question || "Summarize this device snapshot.").slice(0, 4000)}\n\nAuthorized device snapshot:\n${JSON.stringify(clean)}`
    }],
    research: null
  });
  return {
    reply: result.reply,
    provider: result.provider,
    model: result.model,
    snapshot: clean
  };
}

function createActionRouter({ env = process.env } = {}) {
  const router = express.Router();

  router.get("/status", (req, res) => {
    return res.json({
      browser: publicBrowserControlStatus(env),
      device: {
        browserBridge: true,
        nativeBridge: "client-dependent",
        privateOsSandboxBypass: false,
        explicitPermissionRequired: true
      }
    });
  });

  router.post("/browser/task", async (req, res) => {
    try {
      const result = await startBrowserTask({
        userId: req.user.id,
        url: req.body?.url,
        goal: req.body?.goal,
        variables: req.body?.variables,
        env
      });
      return res.status(result.confirmationRequired ? 202 : 200).json(result);
    } catch (error) {
      console.error("UNBOUND BROWSER TASK ERROR:", error?.code || error?.message || "unknown");
      return res.status(Number(error?.statusCode) || 500).json({
        error: error?.message || "Browser task failed.",
        code: error?.code || "BROWSER_TASK_FAILED"
      });
    }
  });

  router.post("/browser/task/:taskId/confirm", async (req, res) => {
    try {
      const result = await confirmBrowserTask({
        userId: req.user.id,
        taskId: req.params.taskId
      });
      return res.status(result.confirmationRequired ? 202 : 200).json(result);
    } catch (error) {
      return res.status(Number(error?.statusCode) || 500).json({
        error: error?.message || "Browser task confirmation failed.",
        code: error?.code || "BROWSER_CONFIRM_FAILED"
      });
    }
  });

  router.delete("/browser/task/:taskId", async (req, res) => {
    const result = await cancelBrowserTask({
      userId: req.user.id,
      taskId: req.params.taskId
    });
    return res.json(result);
  });

  router.post("/device/analyze", async (req, res) => {
    try {
      const result = await analyzeDeviceSnapshot({
        snapshot: req.body?.snapshot,
        question: req.body?.question
      });
      return res.json(result);
    } catch (error) {
      console.error("UNBOUND DEVICE ANALYSIS ERROR:", error?.code || error?.message || "unknown");
      return res.status(Number(error?.statusCode) || 500).json({
        error: error?.message || "Device analysis failed.",
        code: error?.code || "DEVICE_ANALYSIS_FAILED"
      });
    }
  });

  return router;
}

function sendControlCenterPage(req, res) {
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(path.join(__dirname, "..", "control-center.html"));
}

module.exports = {
  cleanDeviceSnapshot,
  analyzeDeviceSnapshot,
  createActionRouter,
  sendControlCenterPage
};
