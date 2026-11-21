export const DEFAULT_ALERT_LIMIT = 50;
const MAX_PARSED_LINES = 500;

export interface WafAlert {
  readonly id: string;
  readonly timestamp: string | null;
  readonly clientIp: string | null;
  readonly uri: string | null;
  readonly ruleIds: readonly string[];
  readonly anomalyScore: number | null;
  readonly blocked: boolean;
  readonly messages: readonly string[];
}

export interface WafAlertParseResult {
  readonly alerts: readonly WafAlert[];
  readonly skippedLines: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nested(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (record === null) return null;
  const value = record[key];
  return isRecord(value) ? value : null;
}

function readText(record: Record<string, unknown> | null, key: string): string | null {
  if (record === null) return null;
  const value = record[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

interface MessageScan {
  readonly ruleIds: readonly string[];
  readonly messages: readonly string[];
  readonly anomalyScore: number | null;
}

const SCORE_PATTERN = /(?:Inbound Anomaly Score|Total Score)[^0-9]*(\d+)/i;

function scanMessages(raw: unknown): MessageScan {
  if (!Array.isArray(raw)) return { ruleIds: [], messages: [], anomalyScore: null };
  const ruleIds: string[] = [];
  const messages: string[] = [];
  let anomalyScore: number | null = null;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const details = nested(entry, 'details') ?? entry;
    const ruleId = readText(details, 'ruleId');
    if (ruleId !== null) ruleIds.push(ruleId);
    const message = readText(details, 'msg');
    if (message !== null) messages.push(message);
    const data = readText(details, 'data');
    const matched = data === null ? null : SCORE_PATTERN.exec(data);
    if (matched !== null) anomalyScore = Number.parseInt(matched[1], 10);
  }
  return { ruleIds, messages, anomalyScore };
}

/**
 * Accepts both shapes the image can emit: one JSON object per line wrapped in
 * `transaction`, or the transaction object itself. A native-format audit log has no
 * JSON object per line, so every line lands in skippedLines instead of being guessed at.
 */
function toAlert(line: string): WafAlert | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const transaction = nested(parsed, 'transaction') ?? parsed;
  const request = nested(transaction, 'request');
  const scan = scanMessages(nested(transaction, 'audit_data')?.messages ?? transaction.messages);
  return {
    id: readText(transaction, 'unique_id') ?? 'unknown',
    timestamp: readText(transaction, 'time_stamp') ?? readText(transaction, 'timestamp'),
    clientIp: readText(transaction, 'client_ip'),
    uri: readText(request, 'uri'),
    ruleIds: scan.ruleIds,
    anomalyScore: scan.anomalyScore,
    blocked: transaction.is_interrupted === true,
    messages: scan.messages,
  };
}

export function parseWafAuditEntries(raw: string, limit: number = DEFAULT_ALERT_LIMIT): WafAlertParseResult {
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const window = lines.slice(-MAX_PARSED_LINES);
  const alerts: WafAlert[] = [];
  let skippedLines = 0;
  for (const line of window) {
    const alert = toAlert(line);
    if (alert === null) {
      skippedLines += 1;
      continue;
    }
    alerts.push(alert);
  }
  return { alerts: alerts.slice(-limit).reverse(), skippedLines };
}
