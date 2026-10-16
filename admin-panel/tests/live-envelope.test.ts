import { describe, expect, it } from 'vitest';

import { decodeLiveEnvelope, encodeLiveEnvelope, sectionReadAt } from '@/lib/live/frames';

/**
 * The live envelope's per-section reads: the shape every stream states and every consumer resolves.
 *
 * Why a unit test of the envelope and not one more surface test: every stream shares this contract, so
 * what a frame may state — and what a consumer must refuse — is one question for all of them, and the
 * surface tests can only show it second-hand through a panel.
 */

const EARLIER = '2026-10-16T11:58:00.000Z';
const LATER = '2026-10-16T12:00:00.000Z';

describe('live envelope section reads', () => {
  it('round-trips the reads a frame carried forward', () => {
    const declared = { services: EARLIER, traffic: EARLIER };
    const envelope = decodeLiveEnvelope<{ services: string }>(
      encodeLiveEnvelope({ services: 'up' }, LATER, declared),
    );

    expect(envelope?.readAt).toBe(LATER);
    expect(envelope?.frame).toEqual({ services: 'up' });
    expect(envelope?.reads).toEqual(declared);
  });

  it('states nothing for a section the frame\'s own read produced, rather than repeating the instant', () => {
    // The pass that produced the frame read these sections, so `readAt` already says when — a per-section
    // copy of one instant is the duplicate the envelope exists without.
    expect(encodeLiveEnvelope({ workers: [] }, LATER)).toBe(
      JSON.stringify({ readAt: LATER, frame: { workers: [] } }),
    );
    expect(encodeLiveEnvelope({ workers: [] }, LATER, {})).toBe(
      JSON.stringify({ readAt: LATER, frame: { workers: [] } }),
    );
  });

  it('resolves a section to its own read, and to the frame\'s where it shares it', () => {
    const reads = { services: EARLIER };
    expect(sectionReadAt(LATER, reads, 'services')).toBe(EARLIER);
    expect(sectionReadAt(LATER, reads, 'workers')).toBe(LATER);
    expect(sectionReadAt(LATER, undefined, 'workers')).toBe(LATER);
  });

  it('drops a frame whose section read cannot be dated, rather than only that entry', () => {
    // Falling back to `readAt` for the section would date a carried-forward section by a read that never
    // produced it — the misdating the per-section reads exist to prevent, only harder to see.
    expect(decodeLiveEnvelope(JSON.stringify({ readAt: LATER, frame: { services: 'up' }, reads: { services: 'not an instant' } }))).toBeNull();
  });

  it('drops a frame whose section reads are not a map of instants at all', () => {
    expect(decodeLiveEnvelope(JSON.stringify({ readAt: LATER, frame: {}, reads: 'later' }))).toBeNull();
    expect(decodeLiveEnvelope(JSON.stringify({ readAt: LATER, frame: {}, reads: null }))).toBeNull();
    expect(decodeLiveEnvelope(JSON.stringify({ readAt: LATER, frame: {}, reads: { services: 7 } }))).toBeNull();
  });
});
