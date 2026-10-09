import {
  applyConfigTomlUpdates,
  extractConfigTomlValues,
  type ConfigTomlKey,
  type ConfigTomlUpdate,
} from '@/lib/config-toml';

export const WAF_CRS_FILE = 'config/modsecurity/crs-setup.conf';

export const WAF_TOML_KEYS = {
  enabled: { section: 'infra', key: 'WAF_ENABLED' },
  ruleEngine: { section: 'infra', key: 'WAF_RULE_ENGINE' },
  responseBodyAccess: { section: 'infra', key: 'WAF_RESP_BODY_ACCESS' },
  paranoia: { section: 'infra', key: 'WAF_PARANOIA' },
  anomalyInbound: { section: 'infra', key: 'WAF_ANOMALY_INBOUND' },
  anomalyOutbound: { section: 'infra', key: 'WAF_ANOMALY_OUTBOUND' },
} as const satisfies Readonly<Record<string, ConfigTomlKey>>;

export const WAF_RULE_ENGINES = ['On', 'DetectionOnly'] as const;
export const WAF_RESPONSE_BODY_ACCESS = ['Off', 'On', 'Force', 'Rejected'] as const;

export const PARANOIA_MIN = 1;
export const PARANOIA_MAX = 4;
export const ANOMALY_MIN = 1;
export const ANOMALY_MAX = 100;

export type WafRuleEngine = (typeof WAF_RULE_ENGINES)[number];
export type WafResponseBodyAccess = (typeof WAF_RESPONSE_BODY_ACCESS)[number];

export const WAF_DEFAULTS = {
  enabled: false,
  ruleEngine: 'DetectionOnly',
  responseBodyAccess: 'Off',
  paranoia: 1,
  anomalyInbound: 5,
  anomalyOutbound: 4,
} as const satisfies WafSettings;

export interface WafSettings {
  readonly enabled: boolean;
  readonly ruleEngine: WafRuleEngine;
  readonly responseBodyAccess: WafResponseBodyAccess;
  readonly paranoia: number;
  readonly anomalyInbound: number;
  readonly anomalyOutbound: number;
}

export interface WafSettingsInput {
  readonly enabled: string;
  readonly ruleEngine: string;
  readonly responseBodyAccess: string;
  readonly paranoia: string;
  readonly anomalyInbound: string;
  readonly anomalyOutbound: string;
}

export interface WafSettingsResult {
  readonly settings: WafSettings | null;
  readonly errors: readonly string[];
}

/** The CRS knobs that only config/modsecurity/crs-setup.conf can express. */
export interface WafCrsSettings {
  readonly paranoia: number;
  readonly anomalyInbound: number;
  readonly anomalyOutbound: number;
}

const CRS_DIRECTIVES = {
  paranoia: 'tx.paranoia_level',
  blockingParanoia: 'tx.blocking_paranoia_level',
  detectionParanoia: 'tx.detection_paranoia_level',
  anomalyInbound: 'tx.inbound_anomaly_score_threshold',
  anomalyOutbound: 'tx.outbound_anomaly_score_threshold',
} as const;

function decodeTomlRaw(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  return trimmed.split('#')[0].trim();
}

function parseBooleanFlag(raw: string): boolean | null {
  const normalized = decodeTomlRaw(raw).toLowerCase();
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return null;
}

function parseIntegerInRange(raw: string, min: number, max: number): number | null {
  const parsed = Number.parseInt(decodeTomlRaw(raw), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseEnum<T extends string>(raw: string, allowed: readonly T[]): T | null {
  const decoded = decodeTomlRaw(raw);
  return allowed.find((candidate) => candidate === decoded) ?? null;
}

function validateFlag(raw: string, errors: string[]): boolean {
  const parsed = parseBooleanFlag(raw);
  if (parsed === null) errors.push('WAF_ENABLED must be 0 or 1');
  return parsed ?? false;
}

function validateEnum<T extends string>(raw: string, allowed: readonly T[], field: string, errors: string[]): T {
  const parsed = parseEnum(raw, allowed);
  if (parsed === null) errors.push(`${field} must be one of: ${allowed.join(', ')}`);
  return parsed ?? allowed[0];
}

function validateInteger(raw: string, min: number, max: number, field: string, errors: string[]): number {
  const parsed = parseIntegerInRange(raw, min, max);
  if (parsed === null) errors.push(`${field} must be an integer between ${min} and ${max}`);
  return parsed ?? min;
}

export function validateWafSettings(input: WafSettingsInput): WafSettingsResult {
  const errors: string[] = [];
  const settings: WafSettings = {
    enabled: validateFlag(input.enabled, errors),
    ruleEngine: validateEnum(input.ruleEngine, WAF_RULE_ENGINES, 'WAF_RULE_ENGINE', errors),
    responseBodyAccess: validateEnum(
      input.responseBodyAccess,
      WAF_RESPONSE_BODY_ACCESS,
      'WAF_RESP_BODY_ACCESS',
      errors,
    ),
    paranoia: validateInteger(input.paranoia, PARANOIA_MIN, PARANOIA_MAX, 'WAF_PARANOIA', errors),
    anomalyInbound: validateInteger(input.anomalyInbound, ANOMALY_MIN, ANOMALY_MAX, 'WAF_ANOMALY_INBOUND', errors),
    anomalyOutbound: validateInteger(input.anomalyOutbound, ANOMALY_MIN, ANOMALY_MAX, 'WAF_ANOMALY_OUTBOUND', errors),
  };
  return errors.length > 0 ? { settings: null, errors } : { settings, errors: [] };
}

export function readWafTomlSettings(content: string): WafSettings {
  const values = extractConfigTomlValues(content, Object.values(WAF_TOML_KEYS));
  return {
    enabled: parseBooleanFlag(values.WAF_ENABLED) ?? WAF_DEFAULTS.enabled,
    ruleEngine: parseEnum(values.WAF_RULE_ENGINE, WAF_RULE_ENGINES) ?? WAF_DEFAULTS.ruleEngine,
    responseBodyAccess:
      parseEnum(values.WAF_RESP_BODY_ACCESS, WAF_RESPONSE_BODY_ACCESS) ?? WAF_DEFAULTS.responseBodyAccess,
    paranoia: parseIntegerInRange(values.WAF_PARANOIA, PARANOIA_MIN, PARANOIA_MAX) ?? WAF_DEFAULTS.paranoia,
    anomalyInbound:
      parseIntegerInRange(values.WAF_ANOMALY_INBOUND, ANOMALY_MIN, ANOMALY_MAX) ?? WAF_DEFAULTS.anomalyInbound,
    anomalyOutbound:
      parseIntegerInRange(values.WAF_ANOMALY_OUTBOUND, ANOMALY_MIN, ANOMALY_MAX) ?? WAF_DEFAULTS.anomalyOutbound,
  };
}

export function buildWafTomlUpdates(settings: WafSettings): readonly ConfigTomlUpdate[] {
  return [
    { ...WAF_TOML_KEYS.enabled, value: settings.enabled ? '1' : '0' },
    { ...WAF_TOML_KEYS.ruleEngine, value: settings.ruleEngine },
    { ...WAF_TOML_KEYS.responseBodyAccess, value: settings.responseBodyAccess },
    { ...WAF_TOML_KEYS.paranoia, value: String(settings.paranoia) },
    { ...WAF_TOML_KEYS.anomalyInbound, value: String(settings.anomalyInbound) },
    { ...WAF_TOML_KEYS.anomalyOutbound, value: String(settings.anomalyOutbound) },
  ];
}

export function writeWafTomlSettings(content: string, settings: WafSettings): string {
  return applyConfigTomlUpdates(content, buildWafTomlUpdates(settings));
}

function directivePattern(variable: string): RegExp {
  return new RegExp('(setvar:' + variable.replace(/\./g, '\\.') + '=)(\\d+)(?=")', 'g');
}

function replaceDirective(content: string, variable: string, value: number): string {
  const pattern = directivePattern(variable);
  if (!pattern.test(content)) throw new Error(`crs-setup.conf is missing ${variable}`);
  return content.replace(directivePattern(variable), `$1${value}`);
}

function readDirective(content: string, variable: string): number | null {
  const pattern = new RegExp('setvar:' + variable.replace(/\./g, '\\.') + '=(\\d+)(?=")');
  const match = pattern.exec(content);
  return match === null ? null : Number.parseInt(match[1], 10);
}

/** Writes the CRS knobs into the file the container treats as authoritative (MANUAL_MODE=1). */
export function writeWafCrsSettings(content: string, settings: WafCrsSettings): string {
  const paranoia = [
    CRS_DIRECTIVES.paranoia,
    CRS_DIRECTIVES.blockingParanoia,
    CRS_DIRECTIVES.detectionParanoia,
  ].reduce((accumulated, variable) => replaceDirective(accumulated, variable, settings.paranoia), content);
  const inbound = replaceDirective(paranoia, CRS_DIRECTIVES.anomalyInbound, settings.anomalyInbound);
  return replaceDirective(inbound, CRS_DIRECTIVES.anomalyOutbound, settings.anomalyOutbound);
}

export function readWafCrsSettings(content: string): WafCrsSettings | null {
  const paranoia = readDirective(content, CRS_DIRECTIVES.paranoia);
  const anomalyInbound = readDirective(content, CRS_DIRECTIVES.anomalyInbound);
  const anomalyOutbound = readDirective(content, CRS_DIRECTIVES.anomalyOutbound);
  if (paranoia === null || anomalyInbound === null || anomalyOutbound === null) return null;
  return { paranoia, anomalyInbound, anomalyOutbound };
}
