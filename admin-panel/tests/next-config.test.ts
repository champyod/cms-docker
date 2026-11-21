import { describe, expect, it } from 'vitest';

import nextConfig from '../next.config';

describe('next config', () => {
  it('declares a server-action body limit above the 1 MB default', () => {
    // The framework default (1 MB) would silently cap the panel's uploads before
    // their own limit is reached, so the limit must be stated rather than left to
    // the framework.
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe('50mb');
  });

  it('keeps the standalone output the image builds from', () => {
    expect(nextConfig.output).toBe('standalone');
  });
});
