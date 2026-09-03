/**
 * Detector validation.
 *
 * Plants a chirp at a known offset in synthetic noise and checks that the
 * matched filter recovers that offset. This is the part of calibration that can
 * be verified without a browser, a speaker or a microphone, so it is worth
 * pinning down here rather than discovering a sign error on a phone in a
 * rehearsal room.
 *
 * Run: npx tsx scripts/test-dsp.ts
 */

import {
  DEFAULT_CHIRP,
  detectChirp,
  generateChirp,
} from '../frontend/src/lib/dsp.js';

const SAMPLE_RATE = 48000;

let failures = 0;

function check(name: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`  ok    ${name} — ${detail}`);
  } else {
    console.log(`  FAIL  ${name} — ${detail}`);
    failures++;
  }
}

/** Deterministic pseudo-random noise, so runs are reproducible. */
function makeNoise(length: number, amplitude: number, seed = 1): Float32Array {
  const out = new Float32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    out[i] = ((state / 4294967296) * 2 - 1) * amplitude;
  }
  return out;
}

/** Noise with the chirp mixed in at a known sample offset. */
function makeRecording(
  chirp: Float32Array,
  offsetSamples: number,
  chirpGain: number,
  noiseAmplitude: number,
  totalSamples: number,
  seed = 1
): Float32Array {
  const recording = makeNoise(totalSamples, noiseAmplitude, seed);
  for (let i = 0; i < chirp.length; i++) {
    const at = offsetSamples + i;
    if (at < totalSamples) recording[at] += chirp[i] * chirpGain;
  }
  return recording;
}

console.log('\nMatched-filter detector\n');

const chirp = generateChirp(DEFAULT_CHIRP, SAMPLE_RATE);
console.log(
  `  chirp: ${DEFAULT_CHIRP.startHz}-${DEFAULT_CHIRP.endHz}Hz over ` +
    `${DEFAULT_CHIRP.durationMs}ms = ${chirp.length} samples @ ${SAMPLE_RATE}Hz\n`
);

// --- Accuracy across a range of realistic delays --------------------------
console.log('Recovers a known delay:');
const totalSamples = SAMPLE_RATE; // one second
const maxLagSamples = Math.round(0.6 * SAMPLE_RATE);

for (const delayMs of [5, 20, 45, 120, 250, 400]) {
  const offset = Math.round((delayMs / 1000) * SAMPLE_RATE);
  const recording = makeRecording(chirp, offset, 0.5, 0.05, totalSamples);
  const result = detectChirp(recording, chirp, { maxLagSamples });

  const errorSamples = Math.abs(result.sampleIndex - offset);
  const errorMs = (errorSamples / SAMPLE_RATE) * 1000;
  check(
    `${delayMs}ms`,
    errorMs < 1,
    `found ${((result.sampleIndex / SAMPLE_RATE) * 1000).toFixed(2)}ms ` +
      `(error ${errorMs.toFixed(3)}ms, confidence ${result.confidence.toFixed(1)})`
  );
}

// --- Robustness as the room gets louder -----------------------------------
console.log('\nHolds up as noise rises (chirp at 100ms):');
const trueOffset = Math.round(0.1 * SAMPLE_RATE);

for (const [gain, noise] of [
  [0.8, 0.05],
  [0.5, 0.2],
  [0.3, 0.3],
  [0.2, 0.5],
] as [number, number][]) {
  const recording = makeRecording(chirp, trueOffset, gain, noise, totalSamples);
  const result = detectChirp(recording, chirp, { maxLagSamples });
  const errorMs = (Math.abs(result.sampleIndex - trueOffset) / SAMPLE_RATE) * 1000;
  const snr = (20 * Math.log10(gain / noise)).toFixed(0);

  check(
    `chirp ${gain} / noise ${noise} (~${snr}dB)`,
    errorMs < 1,
    `error ${errorMs.toFixed(3)}ms, confidence ${result.confidence.toFixed(1)}`
  );
}

// --- It must not invent a detection ---------------------------------------
console.log('\nRejects a recording with no chirp in it:');
const noiseOnly = makeNoise(totalSamples, 0.3, 99);
const noiseResult = detectChirp(noiseOnly, chirp, { maxLagSamples });
check(
  'pure noise',
  noiseResult.confidence < 5,
  `confidence ${noiseResult.confidence.toFixed(2)} (must stay under the 5 threshold)`
);

const realResult = detectChirp(
  makeRecording(chirp, trueOffset, 0.5, 0.2, totalSamples),
  chirp,
  { maxLagSamples }
);
check(
  'signal vs noise separation',
  realResult.confidence > noiseResult.confidence * 2,
  `real ${realResult.confidence.toFixed(1)} vs noise ${noiseResult.confidence.toFixed(2)}`
);

console.log(
  failures === 0
    ? '\nAll detector checks passed.\n'
    : `\n${failures} detector check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
