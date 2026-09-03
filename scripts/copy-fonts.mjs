/**
 * Copy alphaTab's Bravura font into the frontend's public directory.
 *
 * alphaTab will not render a single note without this font — it logs
 * "Font not available, rendering cannot start" and gives up, while the synth
 * plays on regardless. The failure looks like a blank score with working audio.
 *
 * The alphaTab Vite plugin can copy the font itself, but it does so on a build
 * hook that races Vite emptying the output directory, so the font is present
 * after some builds and missing after others. Vite's `public/` directory has no
 * such ambiguity: it is served at / during development and copied into the
 * build output every time.
 *
 * Runs automatically via the frontend's predev/prebuild scripts.
 */
import { createRequire } from 'node:module';
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const source = path.join(path.dirname(require.resolve('@coderline/alphatab')), 'font');
const target = path.join(repoRoot, 'frontend', 'public', 'font');

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

const copied = await readdir(target);
console.log(`[fonts] ${copied.length} file(s) -> frontend/public/font`);
