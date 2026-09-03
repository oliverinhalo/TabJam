/**
 * Spoken beat counting, for the metronome's 'spoken' mode.
 *
 * alphaTab's built-in metronome covers the click; counting out loud needs the
 * Web Speech API driven from beat events. This only ever runs on the
 * audio-output device — the caller enforces that.
 */

/** Speech is queued by the browser, so a backlog would drift behind the music. */
let lastSpokenAt = 0;
const MIN_GAP_MS = 120;

function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Say a beat number.
 *
 * @param beatNumber 1-based beat within the bar.
 * @param isNewBar   True on the downbeat, which gets a firmer delivery.
 */
export function speakBeat(beatNumber: number, isNewBar: boolean): void {
  if (!canSpeak()) return;

  const now = Date.now();
  if (now - lastSpokenAt < MIN_GAP_MS) return;
  lastSpokenAt = now;

  // Drop anything still queued so the count never lags the playhead.
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(String(beatNumber));
  // Fast and clipped: this has to fit inside one beat at practice tempos.
  utterance.rate = 2.2;
  utterance.pitch = isNewBar ? 1.15 : 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

/** Stop any pending speech, e.g. when playback stops or the mode changes. */
export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

/** Browsers need a user gesture before speech works; call this from a click. */
export function primeSpeech(): void {
  if (!canSpeak()) return;
  const warmup = new SpeechSynthesisUtterance('');
  warmup.volume = 0;
  window.speechSynthesis.speak(warmup);
}
