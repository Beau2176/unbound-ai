import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SCHEME = 'unbound';
const APP_ID = 'ai.unbound.app';
const args = new Set(process.argv.slice(2));
const configureAndroid = args.has('--android') || (!args.has('--android') && !args.has('--ios'));
const configureIos = args.has('--ios') || (!args.has('--android') && !args.has('--ios'));

async function patchAndroid() {
  const manifestPath = resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
  const stringsPath = resolve(process.cwd(), 'android/app/src/main/res/values/strings.xml');
  let manifest = await readFile(manifestPath, 'utf8');
  let strings = await readFile(stringsPath, 'utf8');

  const stringPattern = /<string\s+name="custom_url_scheme">[\s\S]*?<\/string>/;
  const schemeString = `<string name="custom_url_scheme">${SCHEME}</string>`;
  if (stringPattern.test(strings)) {
    strings = strings.replace(stringPattern, schemeString);
  } else {
    const marker = '</resources>';
    if (!strings.includes(marker)) throw new Error('Android strings.xml resources marker is missing.');
    strings = strings.replace(marker, `    ${schemeString}\n${marker}`);
  }

  const activityMatch = manifest.match(/<activity\b[^>]*android:name="\.MainActivity"[\s\S]*?<\/activity>/);
  if (!activityMatch) throw new Error('Android MainActivity block is missing or changed unexpectedly.');

  let activity = activityMatch[0];
  const hasViewFilter = activity.includes('android.intent.action.VIEW') && activity.includes('@string/custom_url_scheme');
  if (!hasViewFilter) {
    const filter = `\n            <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="@string/custom_url_scheme" />\n            </intent-filter>`;
    activity = activity.replace('</activity>', `${filter}\n        </activity>`);
    manifest = manifest.replace(activityMatch[0], activity);
  }

  if (!manifest.includes('android.intent.action.VIEW') || !manifest.includes('@string/custom_url_scheme')) {
    throw new Error('Android custom URL intent filter verification failed.');
  }
  if (!strings.includes(schemeString)) {
    throw new Error('Android custom URL scheme string verification failed.');
  }

  await writeFile(manifestPath, manifest);
  await writeFile(stringsPath, strings);
  console.log(`Android custom URL scheme registered: ${SCHEME}:`);
}

async function patchIos() {
  const plistPath = resolve(process.cwd(), 'ios/App/App/Info.plist');
  let plist = await readFile(plistPath, 'utf8');

  if (!plist.includes('<key>CFBundleURLTypes</key>')) {
    const marker = plist.lastIndexOf('</dict>');
    if (marker < 0) throw new Error('iOS Info.plist root dictionary marker is missing.');
    const block = `\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>${APP_ID}</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${SCHEME}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n`;
    plist = `${plist.slice(0, marker)}${block}${plist.slice(marker)}`;
  } else if (!plist.includes(`<string>${SCHEME}</string>`)) {
    throw new Error('iOS already defines CFBundleURLTypes without the UNBOUND scheme; refusing an ambiguous automatic merge.');
  }

  if (!plist.includes('<key>CFBundleURLTypes</key>') || !plist.includes(`<string>${APP_ID}</string>`) || !plist.includes(`<string>${SCHEME}</string>`)) {
    throw new Error('iOS custom URL scheme verification failed.');
  }

  await writeFile(plistPath, plist);
  console.log(`iOS custom URL scheme registered: ${SCHEME}:`);
}

try {
  if (configureAndroid) await patchAndroid();
  if (configureIos) await patchIos();
} catch (error) {
  console.error(`UNBOUND AI native deep-link configuration failed: ${error?.message || error}`);
  process.exit(1);
}
