import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const required = [
  'assets/icon-only.png',
  'assets/splash.png'
];

const missing = [];
for (const relativePath of required) {
  try {
    await access(resolve(process.cwd(), relativePath));
  } catch {
    missing.push(relativePath);
  }
}

if (missing.length) {
  console.error('UNBOUND AI native branding assets are not ready.');
  console.error('Do not substitute generic artwork. Add the official blue-and-gold infinity artwork to:');
  for (const file of missing) console.error(` - ${file}`);
  console.error('The app icon should be the blue-and-gold infinity symbol from the official UNBOUND AI branding.');
  process.exit(1);
}

console.log('UNBOUND AI official native branding assets are present.');
