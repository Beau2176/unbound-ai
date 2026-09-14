import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const required = [
  {
    path: 'assets/icon-only.png',
    width: 1024,
    height: 1024,
    sha256: '2a8ba2d2f5785400950211dd7578244ee40249d9a777c167f5c07d5397493afa'
  },
  {
    path: 'assets/splash.png',
    width: 2732,
    height: 2732,
    sha256: 'e5dccd6b2352eaa4545540286f34af8827f7fa4ebb11c81dae74c48ae8c33e49'
  }
];

function inspectPng(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a valid PNG');
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('PNG IHDR chunk is missing');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    sha256: createHash('sha256').update(buffer).digest('hex')
  };
}

const failures = [];
for (const asset of required) {
  try {
    const buffer = await readFile(resolve(process.cwd(), asset.path));
    const actual = inspectPng(buffer);
    if (actual.width !== asset.width || actual.height !== asset.height) {
      failures.push(`${asset.path}: expected ${asset.width}x${asset.height}, got ${actual.width}x${actual.height}`);
    }
    if (actual.sha256 !== asset.sha256) {
      failures.push(`${asset.path}: content hash does not match the approved UNBOUND AI brand source`);
    }
  } catch (error) {
    failures.push(`${asset.path}: ${error?.message || 'missing/unreadable'}`);
  }
}

if (failures.length) {
  console.error('UNBOUND AI native branding assets are not ready.');
  console.error('Do not substitute generic artwork or silent placeholders.');
  console.error('The approved sources are derived from the official blue-and-gold UNBOUND AI infinity artwork.');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('UNBOUND AI official native branding assets are present, dimension-correct, and hash-verified.');
