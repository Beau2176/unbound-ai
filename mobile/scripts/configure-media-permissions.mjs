import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CAMERA_DESCRIPTION = 'UNBOUND AI uses the camera only when you choose Photo or Video to capture media for chat.';
const MICROPHONE_DESCRIPTION = 'UNBOUND AI uses the microphone only when you choose a feature that records audio, such as video capture.';

const args = new Set(process.argv.slice(2));
const configureAndroid = args.has('--android') || (!args.has('--android') && !args.has('--ios'));
const configureIos = args.has('--ios') || (!args.has('--android') && !args.has('--ios'));

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function patchAndroid() {
  const manifestPath = resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
  let manifest = await readFile(manifestPath, 'utf8');

  const applicationMarker = manifest.indexOf('<application');
  if (applicationMarker < 0) throw new Error('AndroidManifest.xml application marker is missing.');

  const permissions = [
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO'
  ];

  const optionalFeatures = [
    'android.hardware.camera.any',
    'android.hardware.camera',
    'android.hardware.camera.autofocus',
    'android.hardware.microphone'
  ];

  const additions = [];

  for (const permission of permissions) {
    const pattern = new RegExp(`<uses-permission\\b[^>]*android:name=["']${escapeRegex(permission)}["'][^>]*\\/?>`, 'i');
    if (!pattern.test(manifest)) {
      additions.push(`    <uses-permission android:name="${permission}" />`);
    }
  }

  for (const feature of optionalFeatures) {
    const pattern = new RegExp(`<uses-feature\\b[^>]*android:name=["']${escapeRegex(feature)}["'][^>]*\\/?>`, 'i');
    const normalized = `    <uses-feature android:name="${feature}" android:required="false" />`;
    if (pattern.test(manifest)) {
      manifest = manifest.replace(pattern, normalized.trim());
    } else {
      additions.push(normalized);
    }
  }

  if (additions.length) {
    const insertAt = manifest.indexOf('<application');
    manifest = `${manifest.slice(0, insertAt)}${additions.join('\n')}\n\n    ${manifest.slice(insertAt)}`;
  }

  for (const permission of permissions) {
    if (!manifest.includes(`android:name="${permission}"`)) {
      throw new Error(`Android permission verification failed: ${permission}`);
    }
  }

  for (const feature of optionalFeatures) {
    const pattern = new RegExp(`<uses-feature\\b[^>]*android:name=["']${escapeRegex(feature)}["'][^>]*android:required=["']false["'][^>]*\\/?>`, 'i');
    if (!pattern.test(manifest)) {
      throw new Error(`Android optional feature verification failed: ${feature}`);
    }
  }

  const forbidden = [
    'android.permission.CAPTURE_AUDIO_OUTPUT',
    'android.permission.CAPTURE_VIDEO_OUTPUT',
    'android.permission.FOREGROUND_SERVICE_CAMERA',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE'
  ];
  for (const permission of forbidden) {
    if (manifest.includes(permission)) {
      throw new Error(`Unexpected broad/background media permission is present: ${permission}`);
    }
  }

  await writeFile(manifestPath, manifest);
  console.log('Android user-initiated camera/microphone permissions configured with optional hardware features.');
}

function upsertPlistString(plist, key, value) {
  const escapedKey = escapeRegex(key);
  const pattern = new RegExp(`(<key>${escapedKey}<\\/key>\\s*<string>)[\\s\\S]*?(<\\/string>)`, 'i');
  if (pattern.test(plist)) return plist.replace(pattern, `$1${value}$2`);

  const marker = plist.lastIndexOf('</dict>');
  if (marker < 0) throw new Error('iOS Info.plist root dictionary marker is missing.');
  const block = `\t<key>${key}</key>\n\t<string>${value}</string>\n`;
  return `${plist.slice(0, marker)}${block}${plist.slice(marker)}`;
}

async function patchIos() {
  const plistPath = resolve(process.cwd(), 'ios/App/App/Info.plist');
  let plist = await readFile(plistPath, 'utf8');

  plist = upsertPlistString(plist, 'NSCameraUsageDescription', CAMERA_DESCRIPTION);
  plist = upsertPlistString(plist, 'NSMicrophoneUsageDescription', MICROPHONE_DESCRIPTION);

  if (!plist.includes('<key>NSCameraUsageDescription</key>') || !plist.includes(CAMERA_DESCRIPTION)) {
    throw new Error('iOS camera usage description verification failed.');
  }
  if (!plist.includes('<key>NSMicrophoneUsageDescription</key>') || !plist.includes(MICROPHONE_DESCRIPTION)) {
    throw new Error('iOS microphone usage description verification failed.');
  }

  await writeFile(plistPath, plist);
  console.log('iOS user-initiated camera/microphone usage descriptions configured.');
}

if (configureAndroid) await patchAndroid();
if (configureIos) await patchIos();
