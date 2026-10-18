"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Execute the shipped event handlers with synthetic messages and device voices.
// No network request, real speech service, or customer account is used.
function playbackHarness(runtime, { selection, mobile = false, accessAllowed = false } = {}) {
  const voices = [
    { voiceURI: "device-engine", name: "Google US English", lang: "en-US", localService: true, default: true },
    { voiceURI: "device-engine", name: "Selected device voice", lang: "en-GB", localService: true, default: false }
  ];
  const voiceKey = (voice) => JSON.stringify([voice.voiceURI, voice.name, voice.lang, voice.localService]);
  const storage = new Map([["unbound.voice.systemVoiceURI", selection ?? voiceKey(voices[1])]]);
  const listeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  const utterances = [];
  const requests = [];
  const note = { textContent: "" };
  const attrs = new Map();
  const autoRead = {
    textContent: "", dataset: {},
    setAttribute: (name, value) => attrs.set(name, value),
    getAttribute: (name) => attrs.get(name)
  };
  const picker = { value: selection ?? voiceKey(voices[1]) };
  const send = { disabled: false };
  let timerId = 0;
  let answer = "The completed answer is ready to read.";
  const message = {
    dataset: {}, classList: { contains: () => false }, querySelector: () => null,
    cloneNode: () => ({ innerText: answer, textContent: answer, querySelectorAll: () => [] })
  };
  Object.defineProperty(message.dataset, "speechText", { get: () => answer });
  Object.defineProperty(message, "innerText", { get: () => answer });

  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => voices,
    addEventListener: () => {},
    cancel() { this.speaking = false; },
    resume() { this.paused = false; },
    speak(utterance) { utterances.push(utterance); this.speaking = true; }
  };
  const document = {
    readyState: "complete",
    getElementById: (id) => ({ unboundVoicePreset: picker, unboundVoiceAutoRead: autoRead, sendButton: send }[id] || null),
    querySelector: (selector) => selector === ".unbound-voice-picker-note" ? note : null,
    querySelectorAll: (selector) => selector === ".message.assistant" ? [message] : [],
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); }
  };
  const window = {
    innerWidth: mobile ? 400 : 1200,
    matchMedia: () => ({ matches: mobile }),
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    speechSynthesis: synth,
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: () => ++timerId,
    clearInterval: () => {},
    addEventListener(name, callback) { windowListeners.set(name, callback); },
    fetch(url, options) {
      requests.push({ url, options });
      return Promise.resolve({
        ok: url === "/api/account/access", status: 200,
        json: async () => ({ access: { capabilities: [{ key: "voice", usable: accessAllowed }] } })
      });
    }
  };
  const context = vm.createContext({ window, document, fetch: window.fetch, navigator: { userAgent: mobile ? "Android" : "Desktop" }, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", runtime), "utf8"), context, { filename: runtime });

  function click(kind = "listen") {
    const action = { textContent: "Listen to last answer" };
    const target = { closest: (selector) => selector === "#unboundVoiceAutoRead"
      ? (kind === "auto" ? autoRead : null)
      : selector === ".voice-listen-action" ? action : null };
    listeners.get("click")({ target, preventDefault() {}, stopImmediatePropagation() {} });
  }
  function runShortTimers() {
    for (const [id, timer] of [...timers]) {
      if (timer.delay > 100) continue;
      timers.delete(id);
      timer.callback();
    }
  }
  function startCurrent() { utterances.at(-1)?.onstart?.(); }
  function finishCurrent() {
    synth.speaking = false;
    utterances.at(-1).onend();
    runShortTimers();
  }
  return { window, voices, voiceKey, picker, storage, requests, utterances, note, autoRead, click,
    startCurrent, finishCurrent, runShortTimers, setAnswer: (value) => { answer = value; } };
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test("desktop Listen uses the selected device voice without sending answer text to a server", () => {
  const h = playbackHarness("voice-safe-bridge.js");
  h.click();
  assert.equal(h.requests.length, 0, "Choosing a device voice must not issue a cloud speech request");
  assert.equal(h.utterances.length, 1);
  assert.equal(h.utterances[0].voice, h.voices[1]);
  assert.equal(h.utterances[0].lang, "en-GB");
});

test("desktop playback honors legacy saved voices and a changed device selection", () => {
  const h = playbackHarness("voice-safe-bridge.js", { selection: "Selected device voice" });
  h.click();
  assert.equal(h.requests.length, 0);
  assert.equal(h.utterances.at(-1).voice, h.voices[1]);
  h.storage.set("unbound.voice.systemVoiceURI", h.voiceKey(h.voices[0]));
  h.picker.value = h.voiceKey(h.voices[0]);
  h.click();
  assert.equal(h.utterances.at(-1).voice, h.voices[0]);
});

test("desktop playback preserves currency amounts and decimal numbers", () => {
  const h = playbackHarness("voice-safe-bridge.js");
  const answer = "The price is $1,249.99. Growth is 3.5 percent. Version 2.0 is ready.";
  assert.equal(h.window.__unboundSafeVoiceBridge.splitSpeechText(answer).join(" "), answer);
});

test("desktop playback uses the picker helper when local storage is unavailable", () => {
  const h = playbackHarness("voice-safe-bridge.js", { selection: "clear" });
  h.window.localStorage.getItem = () => { throw new Error("storage unavailable"); };
  h.window.__unboundDeviceVoice = { getVoice: () => h.voices[1] };
  h.click();
  assert.equal(h.utterances.at(-1).voice, h.voices[1]);
  assert.equal(h.requests.length, 0);
});

test("desktop playback falls back to the device default when the saved voice disappears", () => {
  const h = playbackHarness("voice-safe-bridge.js");
  h.voices.pop();
  h.click();
  assert.equal(h.utterances.at(-1).voice, h.voices[0]);
  assert.equal(h.requests.length, 0);
});

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} late cancellation cannot stop a replacement answer`, () => {
    const h = playbackHarness(mobile ? "voice-mobile-fast-path.js" : "voice-safe-bridge.js", { mobile, selection: "clear" });
    h.setAnswer("The earlier answer is no longer wanted.");
    h.click();
    h.startCurrent();
    const cancelled = h.utterances[0];
    const replacement = "Keep reading the replacement answer completely without losing its next section ".repeat(8).trim() + ".";
    h.setAnswer(replacement);
    h.click();
    h.startCurrent();
    const playingNote = h.note.textContent;
    // Android/desktop engines can deliver this after cancel() and the new speak().
    cancelled.onerror({ error: "canceled" });
    assert.equal(h.note.textContent, playingNote, "A cancelled answer must not report failure for the new playback");
    let guard = 0;
    while (guard++ < 20) {
      const before = h.utterances.length;
      h.finishCurrent();
      if (h.utterances.length === before) break;
      h.startCurrent();
    }
    const spoken = h.utterances.slice(1).map((utterance) => utterance.text).join(" ");
    assert.equal(spoken, replacement, "The replacement answer must finish all chunks after a stale error");
    assert(h.utterances.slice(1).every((utterance) => utterance.text.length <= (mobile ? 160 : 220)));
    assert.equal(h.requests.length, 0);
  });
}

test("mobile real playback failure still retries the phone default voice", () => {
  const h = playbackHarness("voice-mobile-fast-path.js", { mobile: true });
  h.click();
  h.utterances[0].onerror({ error: "voice-unavailable" });
  h.runShortTimers();
  assert.equal(h.utterances.length, 2);
  assert.equal(h.utterances[0].voice, h.voices[1]);
  assert.equal(h.utterances[1].voice, h.voices[0]);
  assert.equal(h.requests.length, 0);
});

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} auto-read keeps its existing entitlement check`, async () => {
    const h = playbackHarness(mobile ? "voice-mobile-fast-path.js" : "voice-safe-bridge.js", { mobile });
    h.click("auto");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.requests.map((request) => request.url), ["/api/account/access"]);
    assert.equal(h.storage.get("unbound.voice.autoRead.safe.v2"), "false");
    assert.equal(h.utterances.length, 0);
  });
}

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures += 1; console.error(`FAIL ${name}: ${error.message}`); }
  }
  if (failures) process.exitCode = 1;
})();
