/**
 * Spoken beat counting, for the metronome's 'spoken' mode.
 *
 * alphaTab's built-in metronome covers the click; counting out loud needs the
 * Web Speech API, driven from alphaTab's metronome events. Only ever runs on a
 * device that is producing audio — the caller enforces that.
 */

/** Words for the first few beats. Speaking a numeral is slower than a word. */
const SPOKEN = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

let ready = false;

/**
 * Measured delay between calling speak() and the voice actually starting.
 *
 * This is the whole reason spoken counting has to be scheduled ahead rather
 * than fired on the beat: the browser needs time to start a voice, typically
 * 50-300ms depending on the engine and whether it has warmed up. Speaking when
 * the beat arrives guarantees the word lands after it.
 *
 * Seeded with a middling guess and refined from the real onstart timings, so it
 * adapts to whatever the device is actually doing.
 */
let leadMs = 150;
const MIN_LEAD_MS = 40;
const MAX_LEAD_MS = 400;

/** How far ahead of a beat speech must be started for it to land on time. */
export function speechLeadMs(): number {
  return leadMs;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null;
}

export function isSpeechAvailable(): boolean {
  return synth() !== null;
}

/**
 * Say a beat number.
 *
 * @param beatNumber 1-based beat within the bar.
 * @param isDownbeat True on beat one, which gets a little more emphasis.
 */
export function speakBeat(beatNumber: number, isDownbeat: boolean): void {
  const speech = synth();
  if (!speech) return;

  /**
   * Drop this beat rather than queue behind the last one.
   *
   * Speech queues, so at any real tempo a backlog builds and the count drifts
   * further behind the music with every bar. Cancelling first is not the fix
   * either: cancel() immediately followed by speak() is a well-known way to
   * have Chrome discard the new utterance and fall silent altogether. Skipping
   * a beat we are already late for keeps the count on the music.
   */
  if (speech.speaking || speech.pending) return;

  const utterance = new SpeechSynthesisUtterance(
    SPOKEN[beatNumber - 1] ?? String(beatNumber)
  );
  // Fast and clipped: this has to fit inside one beat at practice tempos.
  utterance.rate = 1.6;
  utterance.pitch = isDownbeat ? 1.2 : 1;
  utterance.volume = 1;

  // Learn how long this device takes to start speaking, and steer the lead
  // towards it. Averaged rather than replaced outright so one slow start does
  // not throw the count off for the following bars.
  const requestedAt = performance.now();
  utterance.onstart = () => {
    const observed = performance.now() - requestedAt;
    leadMs = Math.min(MAX_LEAD_MS, Math.max(MIN_LEAD_MS, leadMs * 0.7 + observed * 0.3));
  };

  speech.speak(utterance);
}

/** Stop any pending speech, e.g. when playback stops or the mode changes. */
export function stopSpeaking(): void {
  synth()?.cancel();
}

/**
 * Unlock speech.
 *
 * Browsers refuse to speak until the API has been used inside a user gesture,
 * so this must be called from a click handler. An empty utterance is not enough
 * on every browser — it needs real text, which is why this speaks a silent word
 * rather than nothing.
 */
export function primeSpeech(): void {
  const speech = synth();
  if (!speech || ready) return;
  ready = true;

  const warmup = new SpeechSynthesisUtterance('one');
  warmup.volume = 0;
  speech.speak(warmup);
}
