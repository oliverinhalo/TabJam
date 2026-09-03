/**
 * Pitch detector validation.
 *
 * Feeds synthetic tones at known frequencies — including one with strong
 * harmonics, which is where naive autocorrelation reports an octave too low —
 * and checks the detector lands within a couple of cents.
 *
 * Run: npx tsx scripts/test-pitch.ts
 */

import { detectPitch, frequencyToNote } from '../frontend/src/lib/dsp.js';

const SAMPLE_RATE = 48000;
let failures = 0;

function check(name: string, condition: boolean, detail: string): void {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${name} — ${detail}`);
  if (!condition) failures++;
}

/** A tone, optionally with harmonics, as a real string produces. */
function tone(frequency: number, seconds: number, harmonics: number[] = [1]): Float32Array {
  const length = Math.round(seconds * SAMPLE_RATE);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    let value = 0;
    for (const [index, gain] of harmonics.entries()) {
      value += gain * Math.sin(2 * Math.PI * frequency * (index + 1) * t);
    }
    out[i] = value * 0.4;
  }
  return out;
}

console.log('\nPitch detector\n');

// Standard guitar tuning, plus a bass low E.
const strings: [string, number][] = [
  ['E2 (low E)', 82.41],
  ['A2', 110.0],
  ['D3', 146.83],
  ['G3', 196.0],
  ['B3', 246.94],
  ['E4 (high E)', 329.63],
  ['E1 (bass)', 41.2],
];

for (const [label, frequency] of strings) {
  const reading = detectPitch(tone(frequency, 0.25), SAMPLE_RATE);
  if (!reading) {
    check(label, false, 'no pitch detected');
    continue;
  }
  const cents = 1200 * Math.log2(reading.frequencyHz / frequency);
  const note = frequencyToNote(reading.frequencyHz);
  check(
    label,
    Math.abs(cents) < 3,
    `${reading.frequencyHz.toFixed(2)}Hz -> ${note.name} (${cents >= 0 ? '+' : ''}${cents.toFixed(1)} cents)`
  );
}

// A guitar's fundamental is often quieter than its harmonics; a naive
// autocorrelation reports an octave down here.
const rich = detectPitch(tone(110, 0.25, [0.4, 1.0, 0.8, 0.5]), SAMPLE_RATE);
check(
  'weak fundamental, strong harmonics',
  rich !== null && Math.abs(1200 * Math.log2(rich.frequencyHz / 110)) < 5,
  rich ? `${rich.frequencyHz.toFixed(2)}Hz (expected ~110)` : 'no pitch detected'
);

// A deliberately out-of-tune string should read as such, not be rounded away.
const flat = detectPitch(tone(107, 0.25), SAMPLE_RATE);
const flatNote = flat ? frequencyToNote(flat.frequencyHz) : null;
check(
  'detects a flat string',
  flatNote !== null && flatNote.name === 'A2' && flatNote.cents < -30,
  flatNote ? `${flatNote.name} ${flatNote.cents} cents` : 'no pitch detected'
);

// Silence and noise must not produce a confident note.
check('silence', detectPitch(new Float32Array(12000), SAMPLE_RATE) === null, 'no reading');

const noise = new Float32Array(12000);
let seed = 7;
for (let i = 0; i < noise.length; i++) {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  noise[i] = (seed / 4294967296) * 2 - 1;
}
const noiseReading = detectPitch(noise, SAMPLE_RATE);
check('noise', noiseReading === null, noiseReading ? `reported ${noiseReading.frequencyHz.toFixed(1)}Hz` : 'no reading');

console.log(failures === 0 ? '\nAll pitch checks passed.\n' : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
