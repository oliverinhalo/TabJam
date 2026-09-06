/**
 * Coordination between tabs of the same browser.
 *
 * Tabs on one machine share one set of speakers, so however many of them are in
 * the room, only one should ever be producing sound. They also need to notice
 * when they are using the same identity, which happens when a tab is
 * duplicated and its sessionStorage is copied along with it.
 *
 * BroadcastChannel is not available everywhere; when it is missing everything
 * here quietly does nothing and the app behaves as it did before.
 */

const CHANNEL = 'tabjam';

type Message =
  /** "I exist and I am using this id." */
  | { kind: 'present'; deviceId: string }
  /** "I have taken the audio role; anyone else on this machine should drop it." */
  | { kind: 'audio'; deviceId: string };

export interface TabChannel {
  /** Announce this tab's identity so a clash can be spotted. */
  announcePresence(deviceId: string): void;
  /** Announce that this tab is now producing sound. */
  announceAudio(deviceId: string): void;
  close(): void;
}

export interface TabHandlers {
  /** Another tab in this browser is using our id; we must take a new one. */
  onIdClash(): void;
  /** Another tab took over audio, so this one should stop producing sound. */
  onAudioTakenElsewhere(): void;
}

export function openTabChannel(
  getDeviceId: () => string,
  handlers: TabHandlers
): TabChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;

  const channel = new BroadcastChannel(CHANNEL);

  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.kind === 'present') {
      // Hearing our own id from somewhere else means two tabs are claiming it.
      // Both sides regenerate; that is a little churn but it always resolves,
      // where deciding which one should yield would need a tie-break both
      // tabs agree on.
      if (message.deviceId === getDeviceId()) handlers.onIdClash();
      return;
    }

    if (message.kind === 'audio' && message.deviceId !== getDeviceId()) {
      handlers.onAudioTakenElsewhere();
    }
  };

  return {
    announcePresence: (deviceId) => channel.postMessage({ kind: 'present', deviceId }),
    announceAudio: (deviceId) => channel.postMessage({ kind: 'audio', deviceId }),
    close: () => channel.close(),
  };
}
