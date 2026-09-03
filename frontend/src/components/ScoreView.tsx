import { useEffect, useRef } from 'react';

interface Props {
  onContainer: (element: HTMLElement | null) => void;
  loading: boolean;
  error: string | null;
  hasSong: boolean;
}

/**
 * The notation surface.
 *
 * alphaTab renders into the inner div and scrolls within the outer one, which
 * is what `player.scrollElement` is pointed at. Selected tracks are rendered
 * stacked vertically by alphaTab's own multi-track layout; a true side-by-side
 * pane grid (one alphaTab instance per track over a shared Score) is the
 * follow-up noted in the README.
 */
export function ScoreView({ onContainer, loading, error, hasSong }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onContainer(ref.current);
    return () => onContainer(null);
  }, [onContainer]);

  return (
    <div className="score">
      {!hasSong && (
        <div className="score__empty">
          <h2>No song loaded</h2>
          <p>Add a Guitar Pro file to get started.</p>
        </div>
      )}

      {loading && <div className="score__status">Loading score…</div>}

      {error && (
        <div className="score__status score__status--error">
          <strong>Could not render this file.</strong>
          <p>{error}</p>
        </div>
      )}

      <div className="score__scroll">
        <div ref={ref} className="score__surface" />
      </div>
    </div>
  );
}
