import type { Participant } from '@tabjam/shared';

interface Props {
  participants: Participant[];
  deviceId: string;
  audioOutputDeviceId: string | null;
  name: string;
  onRename: (name: string) => void;
  onClaimAudio: () => void;
  onReleaseAudio: () => void;
}

export function ParticipantList({
  participants,
  deviceId,
  audioOutputDeviceId,
  name,
  onRename,
  onClaimAudio,
  onReleaseAudio,
}: Props) {
  const isAudioOutput = audioOutputDeviceId === deviceId;
  const online = participants.filter((p) => p.online);

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>In the room</h2>
        <span className="panel__count">{online.length}</span>
      </div>

      <label className="field">
        <span className="field__label">Your name</span>
        <input
          type="text"
          value={name}
          maxLength={40}
          onChange={(event) => onRename(event.target.value)}
        />
      </label>

      <ul className="people">
        {online.map((participant) => {
          const isSelf = participant.deviceId === deviceId;
          const hasAudio = participant.deviceId === audioOutputDeviceId;
          return (
            <li key={participant.deviceId} className="person">
              <span className="person__name">
                {participant.name}
                {isSelf && <span className="person__you"> (you)</span>}
              </span>
              {hasAudio && (
                <span className="badge badge--audio" title="Audio plays on this device">
                  🔊 audio
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {audioOutputDeviceId === null && (
        <p className="panel__hint panel__hint--warn">
          Nobody is producing audio. Claim it to hear playback.
        </p>
      )}

      {isAudioOutput ? (
        <button type="button" className="button button--ghost" onClick={onReleaseAudio}>
          Stop playing audio here
        </button>
      ) : (
        <button type="button" className="button" onClick={onClaimAudio}>
          Play audio on this device
        </button>
      )}
    </section>
  );
}
