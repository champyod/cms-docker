import { describe, expect, it } from 'vitest';

import { logoExtension, logoFileNames, logoPathValue, setLogoPath } from '@/lib/ranking-logo';

// Shaped like the real file: [admin] sits between two other sections, so a
// section-agnostic writer has to guess which one owns the key.
const TOML = [
  '# config.toml — single source of truth',
  '',
  '[core]',
  'POSTGRES_DB = "cmsdb"',
  '',
  '[admin]',
  'RANKING_SESSION_SECRET = ""',
  '',
  '[rpc]',
  'RPC_PORT = 5000',
  '',
].join('\n');

describe('setLogoPath', () => {
  it('writes the logo path into the admin section and leaves other sections alone', () => {
    const updated = setLogoPath(TOML, 'png');

    expect(updated).toContain('RANKING_LOGO_PATH = "./config/assets/logo.png"');
    expect(updated).toContain('[rpc]\nRPC_PORT = 5000');
    expect(updated).toContain('[core]\nPOSTGRES_DB = "cmsdb"');
  });

  it('replaces an existing path rather than adding a second one', () => {
    const twice = setLogoPath(setLogoPath(TOML, 'png'), 'jpg');

    expect(twice.match(/RANKING_LOGO_PATH/g)).toHaveLength(1);
    expect(twice).toContain('RANKING_LOGO_PATH = "./config/assets/logo.jpg"');
  });

  it('clears the path when no logo is stored', () => {
    const cleared = setLogoPath(setLogoPath(TOML, 'png'), null);

    expect(cleared).toContain('RANKING_LOGO_PATH = ""');
    expect(cleared).not.toContain('logo.png');
  });

  it('adds the key to a file the admin section does not carry it in', () => {
    const withoutKey = TOML.replace('RANKING_SESSION_SECRET = ""\n', '');

    expect(setLogoPath(withoutKey, 'gif')).toContain('RANKING_LOGO_PATH = "./config/assets/logo.gif"');
  });
});

describe('logoPathValue', () => {
  it('names the mirror the config example already documents', () => {
    expect(logoPathValue('png')).toBe('./config/assets/logo.png');
  });

  it('is empty when no logo is stored, which is what the service reads as unset', () => {
    expect(logoPathValue(null)).toBe('');
  });
});

describe('logoExtension', () => {
  it('folds the accepted spellings onto the stored extension', () => {
    expect(logoExtension('logo.png')).toBe('png');
    expect(logoExtension('photo.JPEG')).toBe('jpg');
    expect(logoExtension('mark.gif')).toBe('gif');
  });

  it('refuses a name that selects no accepted format', () => {
    expect(logoExtension('archive.zip')).toBeNull();
    expect(logoExtension('noext')).toBeNull();
    expect(logoExtension('')).toBeNull();
  });
});

describe('logoFileNames', () => {
  it('probes every extension the upload surface accepts', () => {
    expect(logoFileNames()).toEqual(['logo.png', 'logo.jpg', 'logo.gif', 'logo.bmp']);
  });
});
