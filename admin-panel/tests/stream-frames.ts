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

/** The payload of one `data: …` frame. */
export function toFrame<TFrame>(frame: string): TFrame {
  return JSON.parse(frame.replace(/^data: /, '').trim()) as TFrame;
}
