import { useCallback, useEffect, useRef, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';
import {
  MAX_INTERPOLATION_DRIFT_MS,
  POSITION_REPORT_INTERVAL_MS,
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
  });

  // Kept in refs so the event handlers below never go stale without needing to
  // tear down and rebuild the alphaTab instance.
  const isAudioOutputRef = useRef(isAudioOutput);
  const metronomeRef = useRef(settings.metronome);
  const reportRef = useRef(onPositionReport);
  const outputLatencyRef = useRef(outputLatencyMs);
  const lastReportRef = useRef(0);
  const lastBarRef = useRef(-1);

  isAudioOutputRef.current = isAudioOutput;
  metronomeRef.current = settings.metronome;
  reportRef.current = onPositionReport;
  outputLatencyRef.current = outputLatencyMs;

  // --- Instance lifecycle -------------------------------------------------

  useEffect(() => {
    if (!container) return;

    const api = new alphaTab.AlphaTabApi(container, {
      core: { engine: 'svg', logLevel: alphaTab.LogLevel.Warning },
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
      setState((s) => ({ ...s, tracks, loading: false, error: null }));
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

    // Spoken count-in / beat counting. alphaTab's own click covers 'click'
    // mode; 'spoken' needs the beat boundary, which this event gives us.
    api.playedBeatChanged.on((beat) => {
      if (metronomeRef.current !== 'spoken' || !isAudioOutputRef.current) return;
      const bar = beat.voice?.bar;
      if (!bar) return;

      const beatNumber = (beat.index ?? 0) + 1;
      const isNewBar = bar.index !== lastBarRef.current;
      lastBarRef.current = bar.index;
      speakBeat(beatNumber, isNewBar);
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
    api.masterVolume = isAudioOutput ? settings.masterVolume : 0;
    api.metronomeVolume =
      isAudioOutput && settings.metronome === 'click' ? 1 : 0;
    api.countInVolume = isAudioOutput && settings.countInBars > 0 ? 1 : 0;
    api.playbackSpeed = settings.playbackSpeed;
    api.isLooping = settings.loop;
  }, [
    isAudioOutput,
    settings.masterVolume,
    settings.metronome,
    settings.countInBars,
    settings.playbackSpeed,
    settings.loop,
  ]);

  // Transposition changes both what is displayed and what is played, so it
  // needs a settings update plus a re-render rather than a synth property.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !api.score) return;

    const trackCount = api.score.tracks.length;
    const pitches = new Array<number>(trackCount).fill(settings.transposeSemitones);
    api.settings.notation.transpositionPitches = pitches;
    api.updateSettings();
    api.render();
  }, [settings.transposeSemitones, state.tracks.length]);

  // --- Transport ----------------------------------------------------------

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !state.ready) return;

    if (transport.isPlaying && api.playerState !== alphaTab.synth.PlayerState.Playing) {
      api.play();
    } else if (!transport.isPlaying && api.playerState === alphaTab.synth.PlayerState.Playing) {
      api.pause();
    }
  }, [transport.isPlaying, transport.updatedAt, state.ready]);

  /**
   * Correct drift against the room's position.
   *
   * Estimates where the audio device is *now* by adding the time elapsed since
   * its report, then only snaps if the gap is big enough to be visible. Snapping
   * on every update would fight the local synth and make the cursor stutter.
   */
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !state.ready || isAudioOutput) return;

    // updatedAt is stamped on the server's clock, so the elapsed time has to be
    // measured on that clock too. Using Date.now() directly here would be wrong
    // by however far this device's clock differs from the server's, which on
    // phones is routinely seconds.
    const elapsed = transport.isPlaying
      ? clock.serverNow() - transport.updatedAt
      : 0;
    const expected =
      transport.positionMs + Math.max(0, elapsed) + (listenerOffsetMs ?? 0);

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
