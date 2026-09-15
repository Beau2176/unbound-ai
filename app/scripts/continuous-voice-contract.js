"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { integrateNativeShellServerSource } = require("../ui/native-shell-server-integration");

const root = path.join(__dirname, "..");
const clientPath = path.join(root, "continuous-voice.js");
const serverPath = path.join(root, "server.js");
const nativeShellPath = path.join(root, "ui", "native-shell-server-integration.js");

const client = fs.readFileSync(clientPath, "utf8");
const nativeShell = fs.readFileSync(nativeShellPath, "utf8");
const baseServer = fs.readFileSync(serverPath, "utf8");
const integratedServer = integrateNativeShellServerSource(baseServer);

assert.doesNotThrow(() => new Function(client));

// Hands-Free is opt-in and uses the existing account capability gate.
assert(client.includes("action.addEventListener('click'"));
assert(client.includes("void startHandsFree()"));
assert(client.includes("fetch('/api/account/access'"));
assert(client.includes("item?.key === 'voice'"));
assert(client.includes("Boolean(voice?.usable)"));
assert(client.includes("requires Premium or Ultra Voice access"));

// Playback must stay local and use the selected voice exposed by the operating system/browser.
assert(!client.includes("/api/voice/natural-speech"));
assert(!client.includes("/api/voice/speech"));
assert(!/heygen/i.test(client));
assert(!/openai/i.test(client));
assert(client.includes("unbound.voice.systemVoiceURI"));
assert(client.includes("speechSynthesis.getVoices()"));
assert(client.includes("resolveDeviceVoice"));
assert(client.includes("new window.SpeechSynthesisUtterance"));
assert(client.includes("utterance.voice = voice"));
assert(!client.includes("utterance.lang ="));
assert(!client.includes("navigator.language"));

// Recognition remains independently constrained while playback voice comes from the device.
assert(client.includes("current.lang = 'en-US'"));
assert(client.includes("current.interimResults = false"));
assert(client.includes("current.continuous = false"));
assert(client.includes("scheduleListen(token"));
assert(client.includes("handleRecognizedText(transcript, token)"));
assert(client.includes("waitForCompletedReply"));
assert(client.includes("send.click()"));

// Do not feed UNBOUND's own spoken reply back into chat.
assert(client.includes("POST_SPEECH_LISTEN_DELAY_MS"));
assert(client.includes("ECHO_GUARD_MS"));
assert(client.includes("looksLikeRecentEcho"));
assert(client.includes("Ignored UNBOUND AI hearing its own reply"));
assert(client.includes("window.speechSynthesis.speaking || window.speechSynthesis.pending"));

// Do not read interrupted/error replies aloud.
assert(client.includes("Response interrupted before completion"));
assert(client.includes("reply.error"));
assert(client.includes("will not be read aloud"));

// Users can stop by voice or by returning to typing.
assert(client.includes("stop hands free"));
assert(client.includes("isStopPhrase"));
assert(client.includes("isEditingKey"));
assert(client.includes("Hands-Free stopped because you started typing"));

// Browser backgrounding must pause the microphone and intentional aborts must not become errors.
assert(client.includes("visibilitychange"));
assert(client.includes("document.hidden"));
assert(client.includes("__unboundIntentionalStop"));
assert(client.includes("paused the microphone while UNBOUND AI is in the background"));

// Only the selected device voice may persist; Hands-Free activation itself must not persist.
assert(client.includes("localStorage.getItem"));
assert(!client.includes("sessionStorage"));
assert(!client.includes("getUserMedia"));
const bootStart = client.match(/function boot\(\)[\s\S]*?\n  }/);
assert(bootStart, "Hands-Free boot function is missing");
assert(!bootStart[0].includes("startHandsFree("));

assert(client.includes("setConflictingActionsDisabled(true)"));
assert(client.includes("Voice input|Listen to last answer|Preview selected"));
assert(client.includes("unbound:device-voice-changed"));

assert(nativeShell.includes('app.get("/continuous-voice.js"'));
assert(nativeShell.includes('continuous-voice.js?v=099'));
assert(integratedServer.includes('app.get("/continuous-voice.js"'));
assert(integratedServer.includes('<script src="/continuous-voice.js?v=099" defer></script>'));
assert(integratedServer.includes('Cache-Control", "no-cache, no-store, must-revalidate'));

console.log("Hands-Free Conversation device-voice contract passed.");