interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /** Rendered instead of the raw number, e.g. "+2" or "none". */
  format?: (value: number) => string;
  title?: string;
}

/**
 * A small −/value/+ control.
 *
 * Used instead of a slider for transpose and capo deliberately. A slider fires
 * a change for every pixel of a drag, and each one here costs a room-wide
 * round trip and a full score re-render; the value you land on can be lost in
 * the queue. Discrete steps send exactly one change per press, which also makes
 * hitting a specific value like -1 reliable on a phone.
 */
export function Stepper({ label, value, min, max, onChange, format, title }: Props) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <div className="stepper" title={title}>
      <span className="stepper__label">{label}</span>
      <div className="stepper__controls">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          aria-label={`${label} down`}
        >
          −
        </button>
        <span className="stepper__value">{format ? format(value) : value}</span>
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          aria-label={`${label} up`}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Signed display for semitone values: -1, 0, +2. */
export function formatSemitones(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
