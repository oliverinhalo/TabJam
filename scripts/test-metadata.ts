/**
 * Round-trip test for the library's score metadata.
 *
 * Builds a score from alphaTex, exports it as a real Guitar Pro file, then
 * reads it back through the same code path the library uses. That exercises the
 * actual importer rather than a mock, without needing a Guitar Pro file to be
 * checked into the repo.
 *
 * Run: npx tsx scripts/test-metadata.ts
 */

import { exporter, importer, Settings } from '@coderline/alphatab';
import { readMetadata } from '../backend/src/sources/metadata.js';

let failures = 0;

function check(name: string, condition: boolean, detail: string): void {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${name} — ${detail}`);
  if (!condition) failures++;
}

/** Build a Guitar Pro file from alphaTex, so the fixture is generated not stored. */
function buildGpFile(tex: string): Uint8Array {
  const settings = new Settings();
  const tex_importer = new importer.AlphaTexImporter();
  tex_importer.initFromString(tex, settings);
  const score = tex_importer.readScore();
  return new exporter.Gp7Exporter().export(score, settings);
}

console.log('\nScore metadata (alphaTex -> .gp -> parsed back)\n');

// Tempo and a key with one sharp, which should read back as G major.
const bytes = buildGpFile('\\title "Probe" \\tempo 138 \\ks G . 3.3.4 5.3.4 | 3.3.4 5.3.4');
check('exported a file', bytes.byteLength > 0, `${bytes.byteLength} bytes`);

const meta = readMetadata(Buffer.from(bytes));
console.log('  parsed:', JSON.stringify(meta));

check('tempo', meta.tempoBpm === 138, `got ${meta.tempoBpm}, expected 138`);
check('key', meta.key === 'G', `got ${meta.key}, expected G`);
check('bars', meta.barCount === 2, `got ${meta.barCount}, expected 2`);
check('tracks', meta.trackCount === 1, `got ${meta.trackCount}, expected 1`);

// A flat key, to prove the sign of the signature is read the right way round.
const flat = readMetadata(Buffer.from(buildGpFile('\\tempo 90 \\ks F . 3.3.4')));
check('flat key', flat.key === 'F', `got ${flat.key}, expected F`);

// Unreadable input must degrade rather than throw: a bad file should still list.
const junk = readMetadata(Buffer.from([1, 2, 3, 4, 5]));
check(
  'junk degrades quietly',
  junk.tempoBpm === null && junk.key === null,
  `got ${JSON.stringify(junk)}`
);

console.log(failures === 0 ? '\nAll metadata checks passed.\n' : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
