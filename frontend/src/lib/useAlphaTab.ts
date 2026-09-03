import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';
import {
  MAX_INTERPOLATION_DRIFT_MS,
  POSITION_REPORT_INTERVAL_MS,
  displayTranspose,
  effectiveTranspose,
  trackSettings,
  type RoomSettings,
  type TrackInfo,
  type TransportState,
} from '@tabjam/shared';
import { speakBeat } from './metronome';
import type { ClockSync } from './clock';

/**
 * Default soundfont.
 *
 * alphaTab ships no soundfont in the npm package, so the synth needs one from
 * somewhere. This points at the official CDN copy by default; set
 * VITE_SOUNDFONT_URL to a self-hosted file for a fully offline install (see the
 * README's offline note).
 */
const DEFAULT_SOUNDFONT =
  import.meta.env.VITE_SOUNDFONT_URL ??
  'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.4/dist/soundfont/sonivox.sf3';

export interface AlphaTabState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  tracks: TrackInfo[];
  /** Total score length in ms, once the synth knows it. */
  durationMs: number;
  /** Current playback position in ms. Updates continuously during playback. */
  positionMs: number;
  /** Number of bars in the loaded score, for bounding the loop controls. */
  barCount: number;
}

interface UseAlphaTabArgs {
  container: HTMLElement | null;
  fileUrl: string | null;
  /** Track indexes to render. Empty means "all tracks". */
  selectedTracks: number[];
  settings: RoomSettings;
  transport: TransportState;
  /** Only the audio-output device makes sound and reports position. */
  isAudioOutput: boolean;
  onPositionReport: (positionMs: number, isPlaying: boolean) => void;
  /** Server/client clock estimate. transport.updatedAt is on the server clock. */
  clock: ClockSync;
  /**
   * This device's measured speaker latency, from acoustic calibration.
   * On the audio-output device it shifts reported positions back so the rest of
   * the room follows the sound people actually hear rather than the sound the
   * synth believes it has already produced. null when uncalibrated.
   */
  outputLatencyMs: number | null;
  /**
   * Extra offset for a listening device, from cross-device calibration.
   * Shifts this device's own cursor only.
   */
  listenerOffsetMs?: number | null;
  /**
   * How long this device waits before starting, so its audio emerges at the
   * same moment as the slowest device's. Zero on the slowest device itself and
   * whenever nothing has been calibrated.
   */
  compensationMs?: number;
  /** Notation scale. Local to this device — a phone needs different zoom to a laptop. */
  zoom?: number;
  /** Playback volume for this device, 0..1. Per device, not shared. */
  volume?: number;
  /** Which staves and annotations to draw. Local, like zoom. */
  view?: { showScore: boolean; showTab: boolean; showChords: boolean };
}

/**
 * Owns one alphaTab instance and keeps it in step with the room.
 *
 * Note on the synth: every device runs it, but non-audio devices run it at zero
 * volume. alphaTab drives its cursor from the synth clock, so disabling the
 * player entirely would mean no cursor at all — and a silent local synth gives
 * smooth cursor motion for free, with the broadcast position only needed to
 * correct drift rather than to animate every frame.
 */
export function useAlphaTab({
  container,
  fileUrl,
  selectedTracks,
  settings,
  transport,
  isAudioOutput,
  onPositionReport,
  clock,
  outputLatencyMs,
  listenerOffsetMs,
  compensationMs = 0,
  zoom = 1,
  volume = 0.8,
  view = { showScore: true, showTab: true, showChords: true },
}: UseAlphaTabArgs): AlphaTabState & {
  seekTo: (ms: number) => void;
  api: alphaTab.AlphaTabApi | null;
} {
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const [state, setState] = useState<AlphaTabState>({
    ready: false,
    loading: false,
    error: null,
    tracks: [],
    durationMs: 0,
    positionMs: 0,
    barCount: 0,
  });

  // Kept in refs so the event handlers below never go stale without needing to
  // tear down and rebuild the alphaTab instance.
  const isAudioOutputRef = useRef(isAudioOutput);
  const metronomeRef = useRef(settings.metronome);
  const reportRef = useRef(onPositionReport);
  const outputLatencyRef = useRef(outputLatencyMs);
  const settingsRef = useRef(settings);
  const viewRef = useRef(view);
  const lastReportRef = useRef(0);

  isAudioOutputRef.current = isAudioOutput;
  metronomeRef.current = settings.metronome;
  reportRef.current = onPositionReport;
  outputLatencyRef.current = outputLatencyMs;
  settingsRef.current = settings;
  viewRef.current = view;

  // --- Instance lifecycle -------------------------------------------------

  useEffect(() => {
    if (!container) return;

    const api = new alphaTab.AlphaTabApi(container, {
      core: {
        engine: 'svg',
        logLevel: alphaTab.LogLevel.Warning,
        /**
         * Pin the music font location.
         *
         * alphaTab renders notation with the Bravura SMuFL font and refuses to
         * render at all if it cannot load it — "Font not available, rendering
         * cannot start" — while the synth carries on regardless. That failure
         * mode is a silent blank score with working audio.
         *
         * Left to itself alphaTab derives this path from its own script URL,
         * which lands on /assets/font/ in a production build and inside Vite's
         * pre-bundle directory in dev. The font is at neither: the plugin emits
         * it to /font/. Both cases then 404 into the SPA fallback and the
         * browser tries to parse index.html as a font.
         */
        fontDirectory: '/font/',
      },
      display: { scale: 0.9, stretchForce: 0.85 },
      player: {
        // 'enablePlayer' is what gives us both audio and the cursor.
        enablePlayer: true,
        enableCursor: true,
        enableUserInteraction: true,
        soundFont: DEFAULT_SOUNDFONT,
        scrollElement: container.parentElement ?? container,
        scrollMode: alphaTab.ScrollMode.Continuous,
      },
    });
    apiRef.current = api;

    api.scoreLoaded.on((score) => {
      const tracks: TrackInfo[] = score.tracks.map((track, index) => ({
        index,
        name: track.name?.trim() || `Track ${index + 1}`,
        instrument: undefined,
        instrumentId: track.playbackInfo?.program,
        tuning: track.staves?.[0]?.stringTuning?.tunings ?? [],
        isDrums: track.playbackInfo?.primaryChannel === 9,
        isBass: false,
        isGuitar: false,
        isVocals: false,
      }));
      setState((s) => ({
        ...s,
        tracks,
        barCount: score.masterBars.length,
        loading: false,
        error: null,
      }));
    });

    api.playerReady.on(() => setState((s) => ({ ...s, ready: true })));

    api.error.on((err: unknown) => {
      const message = err instanceof Error ? err.message : 'alphaTab failed to load the score.';
      setState((s) => ({ ...s, error: message, loading: false }));
    });

    api.playerPositionChanged.on((args) => {
      setState((s) =>
        // Avoid a re-render storm: only commit when the value actually moved.
        Math.abs(s.positionMs - args.currentTime) < 20 && s.durationMs === args.endTime
          ? s
          : { ...s, positionMs: args.currentTime, durationMs: args.endTime }
      );

      // Drift correction feed. Only the audio device's clock is authoritative.
      if (isAudioOutputRef.current) {
        const now = Date.now();
        if (now - lastReportRef.current >= POSITION_REPORT_INTERVAL_MS) {
          lastReportRef.current = now;
          // The synth's position is where sound has been *generated*. What
          // reaches the room is that much older, by however long the output
          // path takes — which is exactly what calibration measures.
          const latency = outputLatencyRef.current ?? 0;
          reportRef.current(Math.max(0, args.currentTime - latency), true);
        }
      }
    });

    /**
     * Spoken beat counting.
     *
     * Driven by alphaTab's own metronome events rather than note events. The
     * earlier version counted `playedBeatChanged`, which fires per *note*: a
     * bar of eighth notes counted to eight, and a bar holding one long chord
     * never counted past one. The metronome event is emitted on the actual
     * metrical beat and carries its number in the bar, which is precisely what
     * needs saying out loud.
     *
     * The events are in the generated MIDI regardless of metronome volume, so
     * spoken mode can keep the click silent.
     */
    api.midiEventsPlayedFilter = [alphaTab.midi.MidiEventType.AlphaTabMetronome];
    api.midiEventsPlayed.on((args) => {
      if (metronomeRef.current !== 'spoken' || !isAudioOutputRef.current) return;

      for (const event of args.events) {
        if (!(event instanceof alphaTab.midi.AlphaTabMetronomeEvent)) continue;
        const beatNumber = event.metronomeNumerator + 1;
        speakBeat(beatNumber, event.metronomeNumerator === 0);
      }
    });

    return () => {
      api.destroy();
      apiRef.current = null;
      setState({
        ready: false,
        loading: false,
        error: null,
        tracks: [],
        durationMs: 0,
        positionMs: 0,
        barCount: 0,
      });
    };
  }, [container]);

  // --- Score loading ------------------------------------------------------

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !fileUrl) return;

    setState((s) => ({ ...s, loading: true, error: null, tracks: [] }));

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`Could not fetch the score (${response.status}).`);
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        // load() with raw bytes avoids alphaTab making its own request.
        api.load(new Uint8Array(buffer));
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not load the score.',
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  // --- Track selection ----------------------------------------------------

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !api.score || state.tracks.length === 0) return;

    const all = api.score.tracks;
    const chosen =
      selectedTracks.length === 0
        ? all
        : selectedTracks
            .map((index) => all[index])
            .filter((track): track is NonNullable<typeof track> => Boolean(track));

    api.renderTracks(chosen.length > 0 ? chosen : all);
  }, [selectedTracks, state.tracks.length]);

  // --- Synced settings ----------------------------------------------------

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    // Silence on every device except the one designated to make sound.
    api.masterVolume = isAudioOutput ? volume : 0;
    api.metronomeVolume =
      isAudioOutput && settings.metronome === 'click' ? 1 : 0;
    api.countInVolume = isAudioOutput && settings.countInBars > 0 ? 1 : 0;
    api.playbackSpeed = settings.playbackSpeed;
  }, [
    isAudioOutput,
    volume,
    settings.metronome,
    settings.countInBars,
    settings.playbackSpeed,
  ]);

  /**
   * A key over just the values that change what is drawn.
   *
   * The settings object is replaced on every room broadcast, so depending on it
   * directly would re-render the whole score when someone nudges a track's
   * volume. Re-layout is the expensive operation here; muting is not.
   */
  const renderKey = useMemo(
    () =>
      JSON.stringify([
        settings.transposeSemitones,
        Object.entries(settings.tracks)
          .map(([index, t]) => [index, t.transposeSemitones, t.capo])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        view.showScore,
        view.showTab,
        view.showChords,
      ]),
    [settings.transposeSemitones, settings.tracks, view.showScore, view.showTab, view.showChords]
  );

  /**
   * Transposition, capo and zoom — everything that forces a re-render.
   *
   * Grouped into one debounced effect on purpose. A re-render of a full score
   * is expensive, and these controls change in bursts (dragging a slider fires
   * per pixel). Applying each intermediate value queues renders faster than
   * they complete and the final one can be lost, which shows up as a setting
   * that "doesn't work" when it was simply the value that got dropped.
   * Debouncing means only the value you land on is ever applied.
   */
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.score) return;

    const timer = setTimeout(() => {
      const current = apiRef.current;
      if (!current?.score) return;

      const tracks = current.score.tracks;
      const live = settingsRef.current;

      /**
       * What gets drawn: the sounding transpose minus the capo.
       *
       * Capo is built out of this rather than alphaTab's own `Staff.capo`,
       * which was measured to leave the written frets untouched — it models a
       * capo the Guitar Pro way, raising pitch while the tab stays as written.
       * That is the opposite of what a player wants from a capo control, which
       * is to see the frets they actually press. `displayTranspositionPitches`
       * does not move tab numbers either, so the notation offset is the only
       * lever that does, and the audio is kept in the original key by giving
       * the player its own value below.
       */
      current.settings.notation.transpositionPitches = tracks.map((_, index) =>
        displayTranspose(live, index)
      );

      current.settings.display.scale = zoom;

      /**
       * Which staves to draw.
       *
       * Turning both off would render an empty page, so the preferences hook
       * keeps at least one on and this only has to pick the matching profile.
       */
      current.settings.display.staveProfile =
        viewRef.current.showScore && viewRef.current.showTab
          ? alphaTab.StaveProfile.ScoreTab
          : viewRef.current.showScore
            ? alphaTab.StaveProfile.Score
            : alphaTab.StaveProfile.Tab;

      // Chord names sit above the staff; the diagrams are the grids at the top.
      // They are one control in the UI, so they move together here.
      current.settings.notation.elements.set(
        alphaTab.NotationElement.ChordDiagrams,
        viewRef.current.showChords
      );
      current.settings.notation.elements.set(
        alphaTab.NotationElement.EffectChordNames,
        viewRef.current.showChords
      );

      current.updateSettings();
      current.render();

      /**
       * Transpose the audio.
       *
       * The notation setting only changes what is drawn; the synth goes on
       * playing the MIDI it already loaded. Without this the tab moves and the
       * sound does not, which is worse than no transpose at all because the two
       * disagree.
       *
       * Note this deliberately uses effectiveTranspose, not displayTranspose:
       * the capo term is excluded so a capo renumbers the frets while the room
       * keeps playing in the same key. The player keys these by MIDI channel
       * rather than by track.
       */
      const byChannel = new Map<number, number>();
      for (const [index, track] of tracks.entries()) {
        const semitones = effectiveTranspose(live, index);
        const info = track.playbackInfo;
        if (!info) continue;
        byChannel.set(info.primaryChannel, semitones);
        byChannel.set(info.secondaryChannel, semitones);
      }
      current.player?.applyTranspositionPitches(byChannel);
    }, 250);

    return () => clearTimeout(timer);
    // settingsRef keeps the latest values without making this effect depend on
    // the whole settings object; renderKey decides when a re-render is due.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey, zoom, state.tracks.length]);

  /**
   * Track mixing. Cheap synth-side changes, so no debounce and no re-render:
   * muting a track you are about to play yourself should feel instant.
   */
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.score) return;

    for (const [index, track] of api.score.tracks.entries()) {
      const own = trackSettings(settings, index);
      api.changeTrackMute([track], own.muted);
      api.changeTrackSolo([track], own.solo);
      api.changeTrackVolume([track], own.volume);
    }
  }, [settings.tracks, state.tracks.length]);

  /**
   * Loop a bar range, for drilling one hard passage.
   *
   * Bars are 1-based in the UI because that is how people count them; alphaTab
   * wants MIDI ticks, which come off the master bar list.
   */
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.score) return;

    const range = settings.loopRange;
    if (!range) {
      api.playbackRange = null;
      api.isLooping = settings.loop;
      return;
    }

    const bars = api.score.masterBars;
    const first = bars[Math.min(range.startBar, bars.length) - 1];
    const last = bars[Math.min(range.endBar, bars.length) - 1];
    if (!first || !last) {
      api.playbackRange = null;
      return;
    }

    api.playbackRange = {
      startTick: first.start,
      endTick: last.start + last.calculateDuration(),
    };
    // A range with looping off would play the section once and stop, which is
    // never what selecting a practice range means.
    api.isLooping = true;
  }, [settings.loopRange, settings.loop, state.tracks.length]);

  // --- Transport ----------------------------------------------------------

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !state.ready) return;

    const alreadyPlaying = api.playerState === alphaTab.synth.PlayerState.Playing;

    if (transport.isPlaying && !alreadyPlaying) {
      /**
       * Hold back a device whose speaker is quicker than the slowest one.
       *
       * A device with latency L that starts at t is heard at t + L. Starting it
       * at t + (reference - L) instead means every device is heard at
       * t + reference, so several speakers land together rather than as a flam.
       * Only devices actually producing sound wait; a screen-only device would
       * just fall behind the music.
       *
       * The wait is a timer, so it inherits setTimeout's few milliseconds of
       * jitter. That is well inside the tolerance for the 100-300ms differences
       * this exists to correct, but it is not sample-accurate scheduling.
       */
      const wait = isAudioOutput ? Math.max(0, compensationMs) : 0;
      if (wait === 0) {
        api.play();
        return;
      }

      const timer = setTimeout(() => {
        // The transport may have been stopped again during the wait.
        if (apiRef.current) apiRef.current.play();
      }, wait);
      return () => clearTimeout(timer);
    }

    if (!transport.isPlaying && alreadyPlaying) {
      api.pause();
    }
  }, [
    transport.isPlaying,
    transport.updatedAt,
    state.ready,
    isAudioOutput,
    compensationMs,
  ]);

  /**
   * Correct drift against the room's position.
   *
   * Estimates where the audio device is *now* by adding the time elapsed since
   * its report, then only snaps if the gap is big enough to be visible. Snapping
   * on every update would fight the local synth and make the cursor stutter.
   */
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !state.ready) return;
    // While playing, only followers are corrected; the audio device is the clock.
    if (transport.isPlaying && isAudioOutput) return;

    // updatedAt is stamped on the server's clock, so the elapsed time has to be
    // measured on that clock too. Using Date.now() directly here would be wrong
    // by however far this device's clock differs from the server's, which on
    // phones is routinely seconds.
    if (!transport.isPlaying) {
      /**
       * Stopped: match the room exactly.
       *
       * The drift tolerance below exists to stop a *moving* cursor stuttering
       * as it is nudged. Nothing is moving here, so applying it just left every
       * device parked up to a tolerance-width apart — visibly out of step the
       * moment playback stopped.
       */
      api.timePosition = Math.max(0, transport.positionMs);
      return;
    }

    const expected =
      transport.positionMs +
      Math.max(0, clock.serverNow() - transport.updatedAt) +
      (listenerOffsetMs ?? 0);

    if (Math.abs(api.timePosition - expected) > MAX_INTERPOLATION_DRIFT_MS) {
      api.timePosition = Math.max(0, expected);
    }
  }, [
    transport.positionMs,
    transport.updatedAt,
    transport.isPlaying,
    isAudioOutput,
    listenerOffsetMs,
    clock,
    state.ready,
  ]);

  // An explicit seek always wins, on every device including the audio one.
  const lastSeekRef = useRef(0);
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !state.ready) return;
    if (transport.updatedAt === lastSeekRef.current) return;
    lastSeekRef.current = transport.updatedAt;

    if (Math.abs(api.timePosition - transport.positionMs) > MAX_INTERPOLATION_DRIFT_MS) {
      api.timePosition = transport.positionMs;
    }
  }, [transport.positionMs, transport.updatedAt, state.ready]);

  const seekTo = useCallback((ms: number) => {
    const api = apiRef.current;
    if (api) api.timePosition = ms;
  }, []);

  return { ...state, seekTo, api: apiRef.current };
}
