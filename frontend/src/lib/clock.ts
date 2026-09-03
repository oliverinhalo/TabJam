import type { ClientToServerEvents, ServerToClientEvents } from '@tabjam/shared';
import type { Socket } from 'socket.io-client';

/**
 * Server/client clock synchronisation.
 *
 * The room's transport state is stamped with `updatedAt` from the *server's*
 * clock, but drift correction runs on each client. Comparing those directly
 * assumes every phone and laptop agrees with the server to the millisecond,
 * which they emphatically do not — device clocks routinely sit seconds off.
 * Without this, the "expected position" used for drift correction is wrong by
 * however far the clocks disagree.
 *
 * The estimate is plain NTP: timestamp a probe, have the server echo its own
 * clock, and assume the trip took the same time in each direction.
 */

type TabJamSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface ClockEstimate {
  /** Add this to a local timestamp to get server time. */
  offsetMs: number;
  /** Round-trip time of the sample this estimate came from. */
  rttMs: number;
  sampleCount: number;
}

/** Probes per synchronisation round. */
const SAMPLES_PER_ROUND = 5;
const SAMPLE_GAP_MS = 120;
/** How often to re-estimate; clocks drift slowly, so this can be lazy. */
export const RESYNC_INTERVAL_MS = 30_000;

function probe(socket: TabJamSocket): Promise<{ offset: number; rtt: number } | null> {
  return new Promise((resolve) => {
    const clientSentAt = Date.now();
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, 2000);

    socket.emit('timeSync', { clientSentAt }, (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      const clientRecvAt = Date.now();
      const rtt = clientRecvAt - clientSentAt;
      // Assume the request and the reply each took half the round trip.
      const serverNowAtRecv = result.serverTime + rtt / 2;
      resolve({ offset: serverNowAtRecv - clientRecvAt, rtt });
    });
  });
}

/**
 * Run one synchronisation round.
 *
 * Keeps the sample with the lowest round-trip time rather than averaging: a
 * slow sample means the packet queued somewhere, which breaks the symmetry
 * assumption and skews its offset. The fastest sample is the least contaminated.
 */
export async function estimateClockOffset(
  socket: TabJamSocket
): Promise<ClockEstimate | null> {
  const samples: { offset: number; rtt: number }[] = [];

  for (let i = 0; i < SAMPLES_PER_ROUND; i++) {
    const sample = await probe(socket);
    if (sample) samples.push(sample);
    if (i < SAMPLES_PER_ROUND - 1) {
      await new Promise((r) => setTimeout(r, SAMPLE_GAP_MS));
    }
  }

  if (samples.length === 0) return null;

  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  return { offsetMs: best.offset, rttMs: best.rtt, sampleCount: samples.length };
}

/** Holds the current estimate and converts between the two clocks. */
export class ClockSync {
  private estimate: ClockEstimate | null = null;

  update(estimate: ClockEstimate | null): void {
    if (estimate) this.estimate = estimate;
  }

  get offsetMs(): number {
    return this.estimate?.offsetMs ?? 0;
  }

  get rttMs(): number | null {
    return this.estimate?.rttMs ?? null;
  }

  get synced(): boolean {
    return this.estimate !== null;
  }

  /** Current time on the server's clock. */
  serverNow(): number {
    return Date.now() + this.offsetMs;
  }

  /** Convert a server timestamp to this device's clock. */
  toLocal(serverTime: number): number {
    return serverTime - this.offsetMs;
  }

  /** Convert a local timestamp to the server's clock. */
  toServer(localTime: number): number {
    return localTime + this.offsetMs;
  }
}
