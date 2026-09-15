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

// Syntax must remain valid in the Node version used by Production CI.
assert.doesNotThrow(() => new Function(client));

// Hands-Free is opt-in and uses the existing account capability gate.
assert(client.includes("action.addEventListener('click'"));
assert(client.includes("void startHandsFree()"));
assert(client.includes("fetch('/api/account/access'"));
assert(client.includes("item?.key === 'voice'"));
assert(client.includes("Boolean(voice?.usable)"));
assert(client.includes("requires Premium or Ultra Voice access"));

// The no-spend conversation loop must never call paid voice providers.
assert(!client.includes("/api/voice/natural-speech"));
assert(!client.includes("/api/voice/speech"));
assert(!/heygen/i.test(client));
assert(!/openai/i.test(client));
assert(client.includes("Voice 2 — Clear"));
assert(client.includes("speechSynthesis"));
assert(client.includes("VOICE2_PREFERRED"));
assert(client.includes("new window.SpeechSynthesisUtterance"));

// Recognition is one utterance per browser session but the product loop automatically restarts.
assert(client.includes("current.continuous = false"));
assert(client.includes("scheduleListen(token"));
assert(client.includes("handleRecognizedText(transcript, token)"));
assert(client.includes("waitForCompletedReply"));
assert(client.includes("send.click()"));

// Mobile recognition must stay in U.S. English and must not feed UNBOUND's own spoken reply back into chat.
assert(client.includes("current.lang = 'en-US'"));
assert(client.includes("current.interimResults = false"));
assert(!client.includes("current.lang = navigator.language"));
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

// No persistent always-listening state; each page session requires an explicit user action.
assert(!client.includes("localStorage"));
assert(!client.includes("sessionStorage"));
assert(!client.includes("getUserMedia"));
const bootStart = client.match(/function boot\(\)[\s\S]*?\n  }/);
assert(bootStart, "Hands-Free boot function is missing");
assert(!bootStart[0].includes("startHandsFree("));

// Existing manual voice features are disabled while Hands-Free owns the audio path.
assert(client.includes("setConflictingActionsDisabled(true)"));
assert(client.includes("Voice input|Listen to last answer|Preview selected voice"));

// Static route + homepage injection must remain in the native shell.
assert(nativeShell.includes('app.get("/continuous-voice.js"'));
assert(nativeShell.includes('continuous-voice.js?v=099'));
assert(integratedServer.includes('app.get("/continuous-voice.js"'));
assert(integratedServer.includes('<script src="/continuous-voice.js?v=099" defer></script>'));
assert(integratedServer.includes('Cache-Control", "no-cache, no-store, must-revalidate'));

console.log("Hands-Free Conversation contract passed.");
