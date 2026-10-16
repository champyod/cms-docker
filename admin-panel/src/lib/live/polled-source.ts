import type { LiveConnection, LiveSource, LiveSourceTeardown } from '@/lib/live/stream-route';
import type { LiveSectionReads } from '@/lib/live/frames';

export interface LivePollTrack<TFrame> {
  readonly intervalMs: number;
  /**
   * The frame's sections this track reads.
   *
   * Why a track names them: one frame accumulates what several tracks read on different cadences, so
   * when one track runs the others' sections travel forward untouched. Naming them is what lets the
   * frame state each carried-forward section's own read instead of dating every section by the pass
   * that happened to run last. A track that names none — every single-section cursor and list
   * surface — sends frames exactly as it did before.
   */
  readonly sections?: readonly string[];
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
    // When each track last read, so a pass can state the sections it carried forward. A track that has
    // not read yet — or that shares this pass's millisecond — states nothing.
    const trackReads = new Map<number, string>();

    /**
     * The sections this pass did not read, each with the read that produced it.
     *
     * Why an instant equal to the frame's own is left out: that section was read by this pass in all
     * but name, so `readAt` already says so — restating the same number per section is the duplicate
     * the envelope avoids.
     */
    const carriedReads = (trigger: number, readAt: string): LiveSectionReads | undefined => {
      const reads: Record<string, string> = {};
      options.tracks.forEach((track, index) => {
        if (index === trigger) return;
        const covered = trackReads.get(index);
        if (covered === undefined || covered === readAt) return;
        for (const section of track.sections ?? []) reads[section] = covered;
      });
      return Object.keys(reads).length === 0 ? undefined : reads;
    };

    const push = (trigger: number, readAt: string): void => {
      if (connection.isClosed()) return;
      const next = options.fingerprint(frame);
      if (emitted && next === fingerprint) return;
      fingerprint = next;
      emitted = true;
      connection.emit(frame, { readAt, reads: carriedReads(trigger, readAt) });
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
      // Why after the read and not before it: the instant has to be the moment the data existed, and a
      // read that never returned has no instant to state.
      const readAt = new Date().toISOString();
      trackReads.set(index, readAt);
      push(index, readAt);
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
