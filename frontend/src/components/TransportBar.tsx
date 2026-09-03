import type { TransportState } from '@tabjam/shared';
import { formatTime } from '../lib/format';

interface Props {
  transport: TransportState;
  positionMs: number;
  durationMs: number;
  ready: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (ms: number) => void;
}

/**
 * Transport controls. Open to every participant by design — this is a jam
 * tool, so whoever notices the mistake first can stop and rewind.
 */
export function TransportBar({
  transport,
  positionMs,
  durationMs,
  ready,
  onPlay,
  onPause,
  onSeek,
}: Props) {
  const max = Math.max(durationMs, 1);

  return (
    <div className="transport">
      <button
        type="button"
        className="transport__play"
        onClick={() => (transport.isPlaying ? onPause() : onPlay())}
        disabled={!ready}
        aria-label={transport.isPlaying ? 'Pause' : 'Play'}
      >
        {transport.isPlaying ? '❚❚' : '▶'}
      </button>

      <span className="transport__time" aria-live="off">
        {formatTime(positionMs)}
      </span>

      <input
        className="transport__scrub"
        type="range"
        min={0}
        max={max}
        step={100}
        value={Math.min(positionMs, max)}
        onChange={(event) => onSeek(Number(event.target.value))}
        disabled={!ready}
        aria-label="Seek"
      />

      <span className="transport__time transport__time--total">{formatTime(durationMs)}</span>
    </div>
  );
}
