import { describe, expect, it } from 'vitest';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import {
  FALLBACK_DEPLOYMENT_MODE,
  deploymentModeCopyKey,
  parseDeploymentMode,
} from '@/lib/deployment-mode';

// Shaped like config.toml: DEPLOYMENT_TYPE only exists in [admin], so a section-agnostic read
// would have to guess (the real file also has same-named keys across sections, e.g. WAF_ENABLED).
const TOML = [
  '[core]',
  'IMG_TAG = "major-admin-panel"',
  '',
  '[admin]',
  'DEPLOYMENT_TYPE = "img"         # enum:img,src',
  '',
].join('\n');

describe('parseDeploymentMode', () => {
  it('reads the declared mode out of the commented line the example file carries', () => {
    expect(parseDeploymentMode(TOML)).toEqual({ mode: 'img', resolved: true });
  });

  it('reads src and tolerates the quoting a sync may write', () => {
    expect(parseDeploymentMode('[admin]\nDEPLOYMENT_TYPE = "src"\n')).toEqual({
      mode: 'src',
      resolved: true,
    });
  });

  it('reads an unquoted value without its inline comment', () => {
    expect(parseDeploymentMode('[admin]\nDEPLOYMENT_TYPE = src  # enum:img,src\n')).toEqual({
      mode: 'src',
      resolved: true,
    });
  });

  it('does not read DEPLOYMENT_TYPE from another section', () => {
    expect(parseDeploymentMode('[core]\nDEPLOYMENT_TYPE = "src"\n')).toEqual({
      mode: FALLBACK_DEPLOYMENT_MODE,
      resolved: false,
    });
  });

  it('falls back to the non-rebuilding mode when the file is unreadable', () => {
    expect(parseDeploymentMode(null)).toEqual({ mode: 'img', resolved: false });
  });

  it('falls back to the non-rebuilding mode when the key is absent', () => {
    expect(parseDeploymentMode('[admin]\nADMIN_LISTEN_PORT = 8889\n')).toEqual({
      mode: 'img',
      resolved: false,
    });
  });

  it('falls back to the non-rebuilding mode on an unexpected value', () => {
    expect(parseDeploymentMode('[admin]\nDEPLOYMENT_TYPE = "docker"\n')).toEqual({
      mode: 'img',
      resolved: false,
    });
    expect(parseDeploymentMode('[admin]\nDEPLOYMENT_TYPE = "SRC-BUILD"\n')).toEqual({
      mode: 'img',
      resolved: false,
    });
  });

  it('normalises the case and spacing of a declared value', () => {
    expect(parseDeploymentMode('[admin]\nDEPLOYMENT_TYPE = "  SRC  "\n')).toEqual({
      mode: 'src',
      resolved: true,
    });
  });

  it('never reports a build-capable mode it could not read', () => {
    // The dangerous direction is building when the deployment meant to pull, so no fallback path
    // may resolve to src.
    expect(FALLBACK_DEPLOYMENT_MODE).toBe('img');
  });
});

describe('deploymentModeCopyKey', () => {
  it('maps a resolved mode to its own entry', () => {
    expect(deploymentModeCopyKey({ mode: 'img', resolved: true })).toBe('img');
    expect(deploymentModeCopyKey({ mode: 'src', resolved: true })).toBe('src');
  });

  it('maps an assumed mode to the unresolved entry, not to the img wording', () => {
    // The operator must be able to tell "this deployment pulls" from "the mode could not be read".
    expect(deploymentModeCopyKey({ mode: FALLBACK_DEPLOYMENT_MODE, resolved: false })).toBe('unresolved');
  });

  it('has every key it can return in both dictionaries, with real Thai', () => {
    for (const key of ['img', 'src', 'unresolved'] as const) {
      expect(en.settings.deploymentMode[key].length).toBeGreaterThan(0);
      expect(/[\u0E00-\u0E7F]/.test(th.settings.deploymentMode[key])).toBe(true);
    }
  });
});
