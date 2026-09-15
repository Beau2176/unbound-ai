const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'voice-readability-fix.js'), 'utf8');
const integration = fs.readFileSync(path.join(root, 'ui', 'native-shell-server-integration.js'), 'utf8');

const failures = [];
function requireText(source, text, message) {
  if (!source.includes(text)) failures.push(message);
}

requireText(runtime, "const VERSION = 'unbound-voice-readability-v100'", 'voice readability runtime version marker is missing');
requireText(runtime, "'.message-sources'", 'spoken-answer extraction must remove rendered source controls');
requireText(runtime, "'.inline-citation'", 'spoken-answer extraction must remove inline citation markers');
requireText(runtime, "'button'", 'spoken-answer extraction must remove rendered buttons');
requireText(runtime, "/Android/i.test(navigator.userAgent || '')", 'voice runtime must keep an Android-specific speech path');
requireText(runtime, "const maxLength = android ? 180 : 360", 'Android speech chunks must remain short enough for phone TTS');
requireText(runtime, "chunks.push(...hardSplit(sentence, maxLength))", 'long sentences must be hard-split instead of exceeding the TTS chunk limit');
requireText(runtime, "safeStorageSet(LEGACY_AUTO_READ_STORAGE_KEY, 'false')", 'legacy auto-read must be disabled so two readers cannot talk at once');
requireText(runtime, "event.stopImmediatePropagation()", 'manual and auto-read controls must suppress the older speech handler');
requireText(runtime, "getLastAssistantText()", 'voice runtime must read the latest assistant response through the cleaned extractor');

requireText(integration, 'app.get("/voice-readability-fix.js"', 'server integration must serve the voice readability runtime');
requireText(integration, 'voice-readability-fix.js?v=100', 'homepage must load the voice readability runtime');

const fixIndex = integration.indexOf('voice-readability-fix.js?v=100');
const presetIndex = integration.indexOf('voice-presets.js?v=109');
if (fixIndex === -1 || presetIndex === -1 || fixIndex > presetIndex) {
  failures.push('voice readability runtime must load before the legacy voice preset runtime');
}

try {
  new Function(runtime);
} catch (error) {
  failures.push(`voice readability runtime has invalid JavaScript syntax: ${error.message}`);
}

if (failures.length) {
  console.error('UNBOUND AI voice readability contract failed.');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('UNBOUND AI voice readability checks passed.');
