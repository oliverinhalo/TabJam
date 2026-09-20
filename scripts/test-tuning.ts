/**
 * Transpose and capo arithmetic.
 *
 * The whole feature rests on one sign convention — what is drawn is the
 * sounding transpose *minus* the capo — and a flipped sign there is both easy
 * to write and hard to spot, since it still produces plausible-looking frets.
 * These cases fix the convention in place.
 *
 * Run: npx tsx scripts/test-tuning.ts
 */

import {
  DEFAULT_SETTINGS,
  displayTranspose,
  effectiveTranspose,
  type RoomSettings,
  type TrackSettings,
} from '../shared/src/index.js';

let failures = 0;

function check(name: string, actual: number, expected: number, why: string): void {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name} — got ${actual}, expected ${expected} (${why})`);
  if (!ok) failures++;
}

/** Settings with one track configured. */
function withTrack(track: Partial<TrackSettings>, roomTranspose = 0): RoomSettings {
  return {
    ...DEFAULT_SETTINGS,
    transposeSemitones: roomTranspose,
    tracks: {
      '0': { transposeSemitones: 0, capo: 0, muted: false, solo: false, volume: 1, ...track },
    },
  };
}

console.log('\nTranspose and capo\n');

console.log('Plain transpose moves both what you read and what you hear:');
const down1 = withTrack({}, -1);
check('display', displayTranspose(down1, 0), -1, 'frets drop a semitone');
check('audio', effectiveTranspose(down1, 0), -1, 'so does the pitch');

console.log('\nPer-track transpose adds to the room-wide value:');
const mixed = withTrack({ transposeSemitones: 1 }, -2);
check('display', displayTranspose(mixed, 0), -1, '-2 room, +1 track');
check('audio', effectiveTranspose(mixed, 0), -1, 'same for the audio');

console.log('\nA capo moves the frets but never the pitch:');
const capo2 = withTrack({ capo: 2 });
check('display', displayTranspose(capo2, 0), -2, 'fret 5 reads as 3');
check('audio', effectiveTranspose(capo2, 0), 0, 'still in the written key');

console.log('\nNegative capo — tuned down, reading a tab written at pitch:');
// Eb standard against an E standard tab: fret everything one higher to sound
// the written note.
const flatTuned = withTrack({ capo: -1 });
check('display', displayTranspose(flatTuned, 0), 1, 'fret 5 reads as 6');
check('audio', effectiveTranspose(flatTuned, 0), 0, 'room stays in the written key');

const dropped = withTrack({ capo: -2 });
check('display (down a tone)', displayTranspose(dropped, 0), 2, 'fret 5 reads as 7');
check('audio (down a tone)', effectiveTranspose(dropped, 0), 0, 'pitch untouched');

console.log('\nCapo and transpose combine without interfering:');
const both = withTrack({ capo: -1, transposeSemitones: -3 });
check('display', displayTranspose(both, 0), -2, '-3 transpose, +1 from the capo');
check('audio', effectiveTranspose(both, 0), -3, 'only the transpose is heard');

console.log('\nUntouched tracks fall back to defaults:');
check('display', displayTranspose(DEFAULT_SETTINGS, 5), 0, 'no entry for track 5');
check('audio', effectiveTranspose(DEFAULT_SETTINGS, 5), 0, 'likewise');

console.log(failures === 0 ? '\nAll tuning checks passed.\n' : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
