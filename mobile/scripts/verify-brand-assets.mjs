import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const assetPath = 'assets/logo.svg';
const failures = [];

try {
  const source = await readFile(resolve(process.cwd(), assetPath), 'utf8');

  if (!source.includes('<svg') || !source.includes('viewBox="0 0 1024 1024"')) {
    failures.push(`${assetPath}: expected a 1024x1024 SVG source`);
  }
  if (!source.includes('#030810')) {
    failures.push(`${assetPath}: missing approved UNBOUND dark background`);
  }
  if (!source.includes('#42b8ff') || !source.includes('#ffb347')) {
    failures.push(`${assetPath}: missing approved blue/gold infinity colors`);
  }
  if (!source.includes('id="brandStroke"') || !source.includes('C646 724 864 704 864 512')) {
    failures.push(`${assetPath}: approved infinity geometry is missing`);
  }
  if (/<script\b/i.test(source) || /(?:https?:|data:|javascript:)/i.test(source)) {
    failures.push(`${assetPath}: native mark must be self-contained and contain no executable/external references`);
  }
  if (/<text\b/i.test(source)) {
    failures.push(`${assetPath}: app icon source must remain symbol-only so text is not clipped at small sizes`);
  }
  if (Buffer.byteLength(source, 'utf8') < 1800) {
    failures.push(`${assetPath}: source is unexpectedly small and may be a placeholder`);
  }
} catch (error) {
  failures.push(`${assetPath}: ${error?.message || 'missing/unreadable'}`);
}

if (failures.length) {
  console.error('UNBOUND AI native branding asset is not ready.');
  console.error('Do not substitute generic artwork or silent placeholders.');
  console.error('The approved native mark is derived from the official blue-and-gold UNBOUND AI infinity branding.');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('UNBOUND AI official native SVG mark is present and verified.');
