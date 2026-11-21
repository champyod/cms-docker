import { describe, expect, it, vi } from 'vitest';

import {
  ASSET_MAX_BYTES,
  IMAGE_EXTENSIONS,
  imageMime,
  normalizeImageExtension,
  validateAssetSize,
} from '@/lib/asset-upload';

describe('asset upload policy', () => {
  it('names a cap for every kind the panel accepts', () => {
    expect(Object.keys(ASSET_MAX_BYTES).sort()).toEqual([
      'attachment',
      'avatar',
      'logo',
      'statement',
      'testcase',
    ]);
    for (const bytes of Object.values(ASSET_MAX_BYTES)) {
      expect(bytes).toBeGreaterThan(0);
    }
  });

  it('accepts a file at the cap, refuses one byte more, and refuses empty', () => {
    expect(validateAssetSize('logo', ASSET_MAX_BYTES.logo)).toBeNull();
    expect(validateAssetSize('logo', ASSET_MAX_BYTES.logo + 1)).toContain('too large');
    expect(validateAssetSize('avatar', 0)).toBe('Empty file');
  });

  it('reports the cap in the message so the reader knows which kind failed', () => {
    expect(validateAssetSize('avatar', ASSET_MAX_BYTES.avatar + 1)).toContain('2 MB');
    expect(validateAssetSize('attachment', ASSET_MAX_BYTES.attachment + 1)).toContain('10 MB');
  });

  it('takes each cap from its config key rather than from the source', async () => {
    vi.stubEnv('MAX_LOGO_UPLOAD_BYTES', '4096');
    vi.stubEnv('MAX_AVATAR_UPLOAD_BYTES', '8192');
    vi.resetModules();
    try {
      const fresh = await import('@/lib/asset-upload');
      expect(fresh.ASSET_MAX_BYTES.logo).toBe(4096);
      expect(fresh.ASSET_MAX_BYTES.avatar).toBe(8192);
      // The testcase cap resolves in its own module, so it is proven the same way.
      const limits = await import('@/lib/testcase-limits');
      expect(limits.MAX_TESTCASE_FILE_BYTES).toBe(2 * 1024 * 1024);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('falls back to the declared default when the key is unusable', async () => {
    vi.stubEnv('MAX_LOGO_UPLOAD_BYTES', 'not-a-number');
    vi.resetModules();
    try {
      const fresh = await import('@/lib/asset-upload');
      expect(fresh.ASSET_MAX_BYTES.logo).toBe(5 * 1024 * 1024);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('folds jpeg onto jpg and rejects a format neither surface serves', () => {
    expect(normalizeImageExtension('JPEG')).toBe('jpg');
    expect(normalizeImageExtension('.png')).toBe('png');
    expect(normalizeImageExtension('svg')).toBeNull();
  });

  it('answers every accepted extension with its own mime type', () => {
    expect(IMAGE_EXTENSIONS).toEqual(['png', 'jpg', 'gif', 'bmp']);
    expect(imageMime('png')).toBe('image/png');
    expect(imageMime('jpg')).toBe('image/jpeg');
    expect(imageMime('gif')).toBe('image/gif');
    expect(imageMime('bmp')).toBe('image/bmp');
  });
});
