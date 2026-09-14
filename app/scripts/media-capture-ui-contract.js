const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { integrateNativeShellServerSource } = require("../ui/native-shell-server-integration");

function main() {
  const appRoot = path.resolve(__dirname, "..");
  const media = fs.readFileSync(path.join(appRoot, "media-capture.js"), "utf8");
  assert.match(media, /unboundPhotoButton/);
  assert.match(media, /unboundVideoButton/);
  assert.match(media, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(media, /MediaRecorder/);
  assert.match(media, /capture", "environment"/);
  assert.match(media, /\/api\/image-understanding/);
  assert.match(media, /\/api\/image-tools\/edit/);
  assert.match(media, /representative visual frames/i);
  assert.match(media, /raw video file is not uploaded/i);
  assert.doesNotMatch(media, /fetch\([^)]*video/i, "raw video must not be uploaded by current capture UI");

  const shortcuts = fs.readFileSync(path.join(appRoot, "voice-media-shortcuts.js"), "utf8");
  assert.match(shortcuts, /unboundVoiceMediaShortcuts/);
  assert.match(shortcuts, /unboundVoiceCameraShortcut/);
  assert.match(shortcuts, /unboundVoicePhotosShortcut/);
  assert.match(shortcuts, /unboundVoiceVideoShortcut/);
  assert.match(shortcuts, /unboundVoiceFilesShortcut/);
  assert.match(shortcuts, /Camera/);
  assert.match(shortcuts, /Photos/);
  assert.match(shortcuts, /Video/);
  assert.match(shortcuts, /Files/);
  assert.match(shortcuts, /unboundPhotoButton/);
  assert.match(shortcuts, /unboundVideoButton/);
  assert.match(shortcuts, /\/images\.html/);
  assert.match(shortcuts, /\/files\.html/);
  assert.match(shortcuts, /grid-template-columns:\s*repeat\(2/);
  assert.match(shortcuts, /max-width:\s*100%/);
  assert.match(shortcuts, /unboundMediaActions/);

  const tier = fs.readFileSync(path.join(appRoot, "tier-controls.js"), "utf8");
  assert.match(tier, /\$59\.99 \/ month/);
  assert.match(tier, /\$114\.99 \/ month/);
  assert.match(tier, /Adult Mode is Ultra-only/i);
  assert.match(tier, /JSON\.stringify\(\{ planTier \}\)/);

  const rawServer = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
  const integrated = integrateNativeShellServerSource(rawServer);
  assert.match(integrated, /app\.get\("\/tier-controls\.js"/);
  assert.match(integrated, /app\.get\("\/media-capture\.js"/);
  assert.match(integrated, /app\.get\("\/voice-media-shortcuts\.js"/);
  assert.match(integrated, /tier-controls\.js\?v=20260914/);
  assert.match(integrated, /media-capture\.js\?v=20260914/);
  assert.match(integrated, /voice-media-shortcuts\.js\?v=20260914/);

  const mobileReadme = fs.readFileSync(path.resolve(appRoot, "..", "mobile", "README.md"), "utf8");
  assert.match(mobileReadme, /camera permission/i);
  assert.match(mobileReadme, /microphone permission/i);
  assert.match(mobileReadme, /must not start recording automatically/i);

  console.log("Camera, Photos, Video, Files shortcut and media-capture UI contract passed.");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}