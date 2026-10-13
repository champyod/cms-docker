import type { LiveConnection, LiveSource, LiveSourceTeardown } from '@/lib/live/stream-route';

export interface LivePollTrack<TFrame> {
  readonly intervalMs: number;
  /** Merges this track's reading into the frame; a section the viewer may not read returns it unchanged. */
  readonly read: (frame: TFrame) => Promise<TFrame>;
}

export interface LivePollOptions<TFrame> {
  readonly initial: TFrame;
  /** The frame's identity, so a snapshot that did not move produces no frame. */
  readonly fingerprint: (frame: TFrame) => string;
  /** Sampled in order at startup, then each on its own interval. */
  readonly tracks: readonly LivePollTrack<TFrame>[];
}

/**
 * A source whose frame is a snapshot of one or more polled sections.
 *
 * Why the first successful sample always goes out: it is how the client learns the channel is up and
 * the surface leaves its loading state, whatever the snapshot happens to contain. After that a sample
 * only produces a frame when the fingerprint moves; the builder's `restate` heartbeat covers the
 * stretches where nothing moves.
 */
export function polledSource<TFrame>(options: LivePollOptions<TFrame>): LiveSource<TFrame> {
  return async (connection: LiveConnection<TFrame>): Promise<LiveSourceTeardown> => {
    let frame = options.initial;
    let fingerprint = options.fingerprint(frame);
    let emitted = false;
    const inFlight = new Set<number>();

    const push = (): void => {
      if (connection.isClosed()) return;
      const next = options.fingerprint(frame);
      if (emitted && next === fingerprint) return;
      fingerprint = next;
      emitted = true;
      connection.emit(frame);
    };

    const sample = async (track: LivePollTrack<TFrame>, index: number): Promise<void> => {
      // Why a pass that is still running is skipped rather than queued: `docker inspect` per container
      // can outlast the interval, and a queued pass would overlap the one already reading.
      if (inFlight.has(index) || connection.isClosed()) return;
      inFlight.add(index);
      try {
        frame = await track.read(frame);
      } catch {
        // Ends the stream rather than the page: the client notices and comes back on its own backoff.
        connection.close();
        return;
      } finally {
        inFlight.delete(index);
      }
      push();
    };

    const timers = options.tracks.map((track, index) =>
      setInterval(() => {
        void sample(track, index);
      }, track.intervalMs),
    );

    // Why sequential: the frame the client sees first carries the cheap section, never waiting on the
    // docker-backed one that shares the connection.
    for (const [index, track] of options.tracks.entries()) await sample(track, index);

    return () => {
      for (const timer of timers) clearInterval(timer);
    };
  };
}
