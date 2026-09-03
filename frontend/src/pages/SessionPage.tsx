import { useCallback, useEffect, useState } from 'react';
import { useRoom } from '../lib/useRoom';
import { useAlphaTab } from '../lib/useAlphaTab';
import { stopSpeaking } from '../lib/metronome';
import { ScoreView } from '../components/ScoreView';
import { TransportBar } from '../components/TransportBar';
import { TrackPicker } from '../components/TrackPicker';
import { ParticipantList } from '../components/ParticipantList';
import { SettingsPanel } from '../components/SettingsPanel';
import { SongLoader } from '../components/SongLoader';
import { Notices } from '../components/Notices';

interface Props {
  roomId: string;
}

export function SessionPage({ roomId }: Props) {
  const room = useRoom(roomId);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [selectedTracks, setSelectedTracks] = useState<number[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const onContainer = useCallback((element: HTMLElement | null) => {
    setContainer(element);
  }, []);

  const engine = useAlphaTab({
    container,
    fileUrl: room.song?.fileUrl ?? null,
    selectedTracks,
    settings: room.settings,
    transport: room.transport,
    isAudioOutput: room.isAudioOutput,
    onPositionReport: room.reportPosition,
  });

  // A new song invalidates a track selection made against the previous one.
  useEffect(() => {
    setSelectedTracks([]);
  }, [room.song?.id]);

  // Nothing should still be talking once the mode changes or playback stops.
  useEffect(() => {
    if (room.settings.metronome !== 'spoken' || !room.transport.isPlaying) {
      stopSpeaking();
    }
  }, [room.settings.metronome, room.transport.isPlaying]);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'TabJam session', url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      // The user dismissed the share sheet; nothing to recover from.
    }
  };

  return (
    <div className="session">
      <header className="topbar">
        <div className="topbar__left">
          <a className="topbar__logo" href="/">TabJam</a>
          <button type="button" className="topbar__room" onClick={() => void share()} title="Copy session link">
            {roomId} <span className="topbar__share">share</span>
          </button>
        </div>

        <div className="topbar__center">
          {room.song ? (
            <>
              <span className="topbar__title">{room.song.title}</span>
              <span className="topbar__artist">{room.song.artist}</span>
            </>
          ) : (
            <span className="topbar__artist">No song loaded</span>
          )}
        </div>

        <div className="topbar__right">
          <span className={`status status--${room.connected ? 'on' : 'off'}`}>
            {room.connected ? 'connected' : 'offline'}
          </span>
          <button
            type="button"
            className="topbar__menu"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-expanded={sidebarOpen}
          >
            ☰
          </button>
        </div>
      </header>

      {room.error && <div className="alert alert--error alert--bar">{room.error}</div>}

      <div className="session__body">
        <main className="session__main">
          <ScoreView
            onContainer={onContainer}
            loading={engine.loading}
            error={engine.error}
            hasSong={Boolean(room.song)}
          />

          <TransportBar
            transport={room.transport}
            positionMs={engine.positionMs}
            durationMs={engine.durationMs}
            ready={engine.ready && Boolean(room.song)}
            onPlay={() => room.play(engine.positionMs)}
            onPause={() => room.pause(engine.positionMs)}
            onSeek={(ms) => {
              // Move locally right away so the scrubber feels responsive, then
              // let the broadcast bring everyone else along.
              engine.seekTo(ms);
              room.seek(ms);
            }}
          />
        </main>

        <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
          <SongLoader current={room.song} history={room.history} onLoad={room.loadSong} />

          <TrackPicker
            tracks={engine.tracks}
            selected={selectedTracks}
            onChange={setSelectedTracks}
          />

          <ParticipantList
            participants={room.participants}
            deviceId={room.deviceId}
            audioOutputDeviceId={room.audioOutputDeviceId}
            name={room.name}
            onRename={room.rename}
            onClaimAudio={room.claimAudioOutput}
            onReleaseAudio={room.releaseAudioOutput}
          />

          <SettingsPanel settings={room.settings} onChange={room.updateSettings} />
        </aside>
      </div>

      <Notices notices={room.notices} onDismiss={room.dismissNotice} />
    </div>
  );
}
