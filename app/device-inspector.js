(() => {
  const cap = window.Capacitor;
  const native = Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  const plugin = cap?.Plugins?.UnboundDeviceInspector || cap?.Plugins?.UNBOUNDDeviceInspector || null;
  let lastSnapshot = null;

  const cleanText = (value, max = 180) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

  function browserSnapshot() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    return {
      source: 'browser',
      platform: cleanText(navigator.userAgentData?.platform || navigator.platform || 'web', 80),
      permissionGranted: true,
      deepInspectionAvailable: false,
      browserInspectionAvailable: true,
      system: {
        osVersion: cleanText(navigator.userAgent || '', 100),
        cpuCores: Number(navigator.hardwareConcurrency || 0) || null,
        memoryTotalMb: Number(navigator.deviceMemory || 0) ? Number(navigator.deviceMemory) * 1024 : null,
        memoryAvailableMb: null,
        storageTotalMb: null,
        storageAvailableMb: null,
        batteryPercent: null,
        charging: null,
        networkType: cleanText(connection?.effectiveType || connection?.type || '', 40)
      },
      apps: [],
      processes: [],
      selectedFiles: []
    };
  }

  function normalizeNativeSnapshot(value) {
    const data = value && typeof value === 'object' ? value : {};
    const list = (items, max = 100) => (Array.isArray(items) ? items : []).slice(0, max).map((item) => ({
      name: cleanText(item?.name || item?.label || '', 160),
      id: cleanText(item?.id || item?.packageName || item?.processName || '', 220)
    })).filter((item) => item.name || item.id);
    return {
      source: 'native',
      platform: cleanText(data.platform || (native && cap?.getPlatform ? cap.getPlatform() : 'native'), 80),
      permissionGranted: true,
      deepInspectionAvailable: true,
      browserInspectionAvailable: true,
      system: {
        osVersion: cleanText(data.system?.osVersion || '', 100),
        cpuCores: Number(data.system?.cpuCores || 0) || null,
        memoryTotalMb: Number(data.system?.memoryTotalMb || 0) || null,
        memoryAvailableMb: Number(data.system?.memoryAvailableMb || 0) || null,
        storageTotalMb: Number(data.system?.storageTotalMb || 0) || null,
        storageAvailableMb: Number(data.system?.storageAvailableMb || 0) || null,
        batteryPercent: Number.isFinite(Number(data.system?.batteryPercent)) ? Number(data.system.batteryPercent) : null,
        charging: Boolean(data.system?.charging)
      },
      apps: list(data.apps),
      processes: list(data.processes),
      selectedFiles: []
    };
  }

  async function requestNativeSnapshot() {
    if (!plugin?.getSnapshot) throw new Error('The native device inspector is not installed in this build.');
    if (plugin.requestAccess) {
      const granted = await plugin.requestAccess({ scopes: ['system', 'apps', 'processes'] });
      if (granted && granted.granted === false) throw new Error('Device inspection permission was not granted.');
    }
    return normalizeNativeSnapshot(await plugin.getSnapshot({ scopes: ['system', 'apps', 'processes'] }));
  }

  async function inspectSelectedDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') {
      throw new Error('Folder inspection is not supported by this browser.');
    }
    const directory = await window.showDirectoryPicker({ mode: 'read' });
    const selectedFiles = [];
    for await (const [name, handle] of directory.entries()) {
      if (selectedFiles.length >= 100) break;
      selectedFiles.push({
        name: cleanText(name, 160),
        id: handle.kind === 'directory' ? 'folder' : 'file'
      });
    }
    const snapshot = lastSnapshot || browserSnapshot();
    snapshot.selectedFiles = selectedFiles;
    lastSnapshot = snapshot;
    window.__UNBOUND_DEVICE_INSPECTION__ = snapshot;
    window.dispatchEvent(new CustomEvent('unbound:device-inspection', { detail: snapshot }));
    return snapshot;
  }

  async function inspect() {
    const snapshot = native && plugin ? await requestNativeSnapshot() : browserSnapshot();
    lastSnapshot = snapshot;
    window.__UNBOUND_DEVICE_INSPECTION__ = snapshot;
    window.dispatchEvent(new CustomEvent('unbound:device-inspection', { detail: snapshot }));
    return snapshot;
  }

  async function analyze(question) {
    const snapshot = lastSnapshot || await inspect();
    const response = await fetch('/api/actions/device/analyze', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ snapshot, question: String(question || 'Summarize this device snapshot.') })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Device analysis failed.');
    return data;
  }

  window.UNBOUND_DEVICE_INSPECTOR = Object.freeze({
    inspect,
    analyze,
    inspectSelectedDirectory,
    get available() { return native ? Boolean(plugin) : true; },
    get deepInspectionAvailable() { return Boolean(native && plugin); },
    get snapshot() { return lastSnapshot; }
  });
})();