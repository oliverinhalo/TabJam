import type { Participant } from '@tabjam/shared';

interface Props {
  participants: Participant[];
  deviceId: string;
  audioOutputDeviceIds: string[];
  referenceLatencyMs: number;
  compensationMs: number;
  name: string;
  onRename: (name: string) => void;
  onClaimAudio: () => void;
  onReleaseAudio: () => void;
}

export function ParticipantList({
  participants,
  deviceId,
  audioOutputDeviceIds,
  referenceLatencyMs,
  compensationMs,
  name,
  onRename,
  onClaimAudio,
  onReleaseAudio,
}: Props) {
  const isAudioOutput = audioOutputDeviceIds.includes(deviceId);
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
          const hasAudio = audioOutputDeviceIds.includes(participant.deviceId);
          // The device setting the pace is the slowest one making sound.
          const isReference =
            hasAudio &&
            participant.outputLatencyMs !== null &&
            participant.outputLatencyMs === referenceLatencyMs &&
            referenceLatencyMs > 0;

          return (
            <li key={participant.deviceId} className="person">
              <span className="person__name">
                {participant.name}
                {isSelf && <span className="person__you"> (you)</span>}
              </span>
              {participant.outputLatencyMs !== null && (
                <span className="person__latency" title="Measured speaker delay">
                  {Math.round(participant.outputLatencyMs)}ms
                </span>
              )}
              {isReference && (
                <span className="badge" title="Slowest device — the room waits for this one">
                  pace
                </span>
              )}
              {hasAudio && (
                <span className="badge badge--audio" title="Audio plays on this device">
                  🔊
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {audioOutputDeviceIds.length === 0 && (
        <p className="panel__hint panel__hint--warn">
          Nobody is producing audio. Turn it on somewhere to hear playback.
        </p>
      )}

      {compensationMs > 0 && (
        <p className="panel__hint">
          This device waits {Math.round(compensationMs)}ms so it lines up with the
          slowest one.
        </p>
      )}

      {/*
        Several devices can play at once — each delays itself to the slowest,
        so their outputs land together instead of as a flam.
      */}
      {isAudioOutput ? (
        <button type="button" className="button button--ghost" onClick={onReleaseAudio}>
          Stop playing audio here
        </button>
      ) : (
        <button type="button" className="button" onClick={onClaimAudio}>
          Also play audio here
        </button>
      )}
    </section>
  );
}
