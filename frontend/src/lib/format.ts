/** Format milliseconds as m:ss, for transport readouts. */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Describe a capo position.
 *
 * A negative capo is not a capo on the neck at all — it means the instrument
 * is tuned down, so the frets to press sit higher than the ones written. The
 * wording has to say that rather than showing "capo -1", which reads as
 * nonsense on an instrument.
 */
export function formatCapo(frets: number): string {
  if (frets === 0) return 'none';
  if (frets > 0) return `fret ${frets}`;
  return `${-frets} down`;
}

/** Short form for the badge on a track row. */
export function formatCapoBadge(frets: number): string {
  return frets > 0 ? `capo ${frets}` : `tuned ${frets}`;
}
