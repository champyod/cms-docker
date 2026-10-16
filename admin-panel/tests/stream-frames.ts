/**
 * The frame reader the stream tests share.
 *
 * Why the pending read is remembered per stream: a read abandoned when the quiet timer wins would
 * swallow the next frame, and "no frame was sent" is exactly what several of these tests assert.
 */

const pendingReads = new WeakMap<
  ReadableStreamDefaultReader<Uint8Array>,
  Promise<ReadableStreamReadResult<Uint8Array>>
>();

/** Captured at import time, before a test installs its fake clock. */
const realSetTimeout = globalThis.setTimeout.bind(globalThis);

/** The frames a stream delivered, returned once it has been quiet for a real moment. */
export async function framesWithin(reader: ReadableStreamDefaultReader<Uint8Array>, quietMs = 30): Promise<string[]> {
  const frames: string[] = [];
  for (;;) {
    let pending = pendingReads.get(reader);
    if (pending === undefined) {
      pending = reader.read();
      pendingReads.set(reader, pending);
    }
    const quiet = new Promise<'quiet'>((resolve) => {
      realSetTimeout(() => resolve('quiet'), quietMs);
    });
    const next = await Promise.race([pending, quiet]);
    if (next === 'quiet') return frames;
    pendingReads.delete(reader);
    if (next.done) return frames;
    frames.push(new TextDecoder().decode(next.value));
  }
}

/** The next frame, or null when the stream stayed quiet. */
export async function nextFrame(reader: ReadableStreamDefaultReader<Uint8Array>, quietMs = 30): Promise<string | null> {
  const frames = await framesWithin(reader, quietMs);
  return frames[0] ?? null;
}

/** The payload of one `data: …` frame, unwrapped from the envelope the shared route builder sends. */
export function toFrame<TFrame>(frame: string): TFrame {
  return (JSON.parse(frame.replace(/^data: /, '').trim()) as { frame: TFrame }).frame;
}

/**
 * The instant the fixtures' reads are stamped with.
 *
 * Why a fixed instant instead of a real clock: these tests are about what a frame delivers, and the
 * freshness cue compares instants — a fixed one lets a test say which read produced which row.
 */
export const FRAME_READ_AT = '2026-10-16T12:00:00.000Z';

/**
 * One frame as the stream delivers it: the payload inside the envelope, with the read instant the
 * server stamped it with.
 */
export function encodedFrame<TFrame>(frame: TFrame, readAt: string = FRAME_READ_AT): string {
  return JSON.stringify({ readAt, frame });
}
