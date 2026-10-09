import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  WAF_DEFAULTS,
  readWafCrsSettings,
  readWafTomlSettings,
  validateWafSettings,
  writeWafCrsSettings,
  writeWafTomlSettings,
  type WafSettingsInput,
} from '@/lib/security/waf-config';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CRS_SAMPLE = [
  'SecAction "id:900001,phase:1,nolog,pass,t:none,setvar:tx.paranoia_level=1"',
  'SecAction "id:900100,phase:1,nolog,pass,t:none,setvar:tx.inbound_anomaly_score_threshold=5"',
  'SecAction "id:900110,phase:1,nolog,pass,t:none,setvar:tx.outbound_anomaly_score_threshold=4"',
  'SecAction "id:900200,phase:1,nolog,pass,t:none,setvar:tx.blocking_paranoia_level=1"',
  'SecAction "id:900210,phase:1,nolog,pass,t:none,setvar:tx.detection_paranoia_level=1"',
].join('\n');

const TOML_SAMPLE = [
  '[infra]',
  'WAF_ENABLED = 0                 # enum:0,1',
  'WAF_PARANOIA = 1',
  'WAF_ANOMALY_INBOUND = 5',
  'WAF_ANOMALY_OUTBOUND = 4',
  'WAF_RULE_ENGINE = "DetectionOnly"',
  'WAF_RESP_BODY_ACCESS = "Off"',
  'KEEP_ME = "untouched"',
].join('\n');

function validInput(overrides: Partial<WafSettingsInput> = {}): WafSettingsInput {
  return {
    enabled: '1',
    ruleEngine: 'On',
    responseBodyAccess: 'On',
    paranoia: '2',
    anomalyInbound: '8',
    anomalyOutbound: '6',
    ...overrides,
  };
}

describe('validateWafSettings', () => {
  it('accepts a complete valid set', () => {
    const result = validateWafSettings(validInput());

    expect(result.errors).toEqual([]);
    expect(result.settings).toEqual({
      enabled: true,
      ruleEngine: 'On',
      responseBodyAccess: 'On',
      paranoia: 2,
      anomalyInbound: 8,
      anomalyOutbound: 6,
    });
  });

  it('collects every invalid field instead of stopping at the first', () => {
    const result = validateWafSettings(validInput({ enabled: 'yes', ruleEngine: 'Off', paranoia: '9', anomalyInbound: '0' }));

    expect(result.settings).toBeNull();
    expect(result.errors).toHaveLength(4);
    expect(result.errors.join(' ')).toContain('WAF_PARANOIA');
    expect(result.errors.join(' ')).toContain('WAF_ANOMALY_INBOUND');
  });
});

describe('config.toml WAF keys', () => {
  it('decodes quoted values with inline comments', () => {
    expect(readWafTomlSettings(TOML_SAMPLE)).toEqual({
      enabled: false,
      ruleEngine: 'DetectionOnly',
      responseBodyAccess: 'Off',
      paranoia: 1,
      anomalyInbound: 5,
      anomalyOutbound: 4,
    });
  });

  it('falls back to the documented defaults when a key is absent', () => {
    expect(readWafTomlSettings('[infra]\nWAF_ENABLED = 1\n')).toEqual({ ...WAF_DEFAULTS, enabled: true });
  });

  it('writes every key without disturbing the rest of the file', () => {
    const updated = writeWafTomlSettings(TOML_SAMPLE, {
      enabled: true,
      ruleEngine: 'On',
      responseBodyAccess: 'On',
      paranoia: 3,
      anomalyInbound: 10,
      anomalyOutbound: 7,
    });

    expect(readWafTomlSettings(updated)).toEqual({
      enabled: true,
      ruleEngine: 'On',
      responseBodyAccess: 'On',
      paranoia: 3,
      anomalyInbound: 10,
      anomalyOutbound: 7,
    });
    expect(updated).toContain('KEEP_ME = "untouched"');
    expect(updated).not.toContain('WAF_PARANOIA = 1\n');
  });
});

describe('crs-setup.conf settings', () => {
  it('replaces all three paranoia directives and both thresholds', () => {
    const updated = writeWafCrsSettings(CRS_SAMPLE, { paranoia: 4, anomalyInbound: 12, anomalyOutbound: 9 });

    expect(updated).toContain('setvar:tx.paranoia_level=4');
    expect(updated).toContain('setvar:tx.blocking_paranoia_level=4');
    expect(updated).toContain('setvar:tx.detection_paranoia_level=4');
    expect(updated).toContain('setvar:tx.inbound_anomaly_score_threshold=12');
    expect(updated).toContain('setvar:tx.outbound_anomaly_score_threshold=9');
    expect(readWafCrsSettings(updated)).toEqual({ paranoia: 4, anomalyInbound: 12, anomalyOutbound: 9 });
  });

  it('fails loudly when a directive it must write is missing', () => {
    const paranoiaOnly = [
      'SecAction "id:900001,setvar:tx.paranoia_level=1"',
      'SecAction "id:900200,setvar:tx.blocking_paranoia_level=1"',
      'SecAction "id:900210,setvar:tx.detection_paranoia_level=1"',
    ].join('\\n');

    expect(() => writeWafCrsSettings(paranoiaOnly, {
      paranoia: 2,
      anomalyInbound: 5,
      anomalyOutbound: 4,
    })).toThrow('crs-setup.conf is missing tx.inbound_anomaly_score_threshold');
  });

  it('round-trips the crs file this deployment actually mounts', () => {
    const content = fs.readFileSync(path.join(REPO_ROOT, 'config/modsecurity/crs-setup.conf'), 'utf-8');
    const original = readWafCrsSettings(content);
    expect(original).not.toBeNull();

    const updated = writeWafCrsSettings(content, { paranoia: 2, anomalyInbound: 9, anomalyOutbound: 7 });
    expect(readWafCrsSettings(updated)).toEqual({ paranoia: 2, anomalyInbound: 9, anomalyOutbound: 7 });
    expect(updated).toContain('# OWASP CRS setup');
  });
});
