import { useCallback, useState } from 'react';

/**
 * Per-device view preferences.
 *
 * Deliberately not synced. How you like to read music is personal: the singer
 * wants standard notation, the guitarist wants tab, and someone on a phone
 * propped against an amp wants it bigger than the person with a laptop. Same
 * reasoning as which tracks you display.
 */
export interface Preferences {
  /** Standard notation staff. */
  showScore: boolean;
  /** Tablature staff. */
  showTab: boolean;
  /** Chord names and diagrams. */
  showChords: boolean;
  /** Notation scale. */
  zoom: number;
}

const STORAGE_KEY = 'tabjam.preferences';

const DEFAULTS: Preferences = {
  // Tab on by default: this is a tab tool. Standard notation alongside it is
  // useful for rhythm, so both start on.
  showScore: true,
  showTab: true,
  showChords: true,
  zoom: 1,
};

function load(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      showScore: parsed.showScore ?? DEFAULTS.showScore,
      showTab: parsed.showTab ?? DEFAULTS.showTab,
      showChords: parsed.showChords ?? DEFAULTS.showChords,
      zoom:
        typeof parsed.zoom === 'number' && parsed.zoom > 0 ? parsed.zoom : DEFAULTS.zoom,
    };
  } catch {
    return DEFAULTS;
  }
}

export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  const [preferences, setPreferences] = useState<Preferences>(load);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };

      // Hiding both staves would leave an empty page, so keep one on. If you
      // turn off the one that was showing, the other comes on in its place.
      if (!next.showScore && !next.showTab) {
        if (patch.showTab === false) next.showScore = true;
        else next.showTab = true;
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage blocked; preferences just won't persist.
      }
      return next;
    });
  }, []);

  return [preferences, update];
}
