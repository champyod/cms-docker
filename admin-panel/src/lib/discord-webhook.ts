// Shared by the notification settings and the test-alert action: validation, payload shape, delivery.

// Discord issues webhooks as https://discord.com/api/webhooks/id/token; canary and versioned hosts exist, but nothing else is accepted.
const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d{16,32}\/[A-Za-z0-9_.-]{20,}$/;

const DISCORD_ROLE_ID_PATTERN = /^\d{5,32}$/;

const DISCORD_REQUEST_TIMEOUT_MS = 10_000;
const ERROR_DETAIL_LIMIT = 200;

export const DISCORD_ALERT_COLOR = 3447003;

export type FieldValidation = { ok: true; value: string } | { ok: false; error: string };

export interface DiscordWebhookPayload {
  content?: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    footer: { text: string };
    timestamp: string;
  }>;
}

export interface DiscordDeliveryResult {
  success: boolean;
  status: number;
  error?: string;
}

/** Empty clears the webhook; anything non-empty must be a real endpoint, or alerts disappear without a trace. */
export function validateDiscordWebhookUrl(raw: string): FieldValidation {
  const value = raw.trim();
  if (value === '') {
    return { ok: true, value: '' };
  }
  if (!value.startsWith('https://')) {
    return { ok: false, error: 'The webhook URL must start with https://' };
  }
  if (!DISCORD_WEBHOOK_PATTERN.test(value)) {
    return {
      ok: false,
      error: 'Not a Discord webhook URL: expected https://discord.com/api/webhooks/<id>/<token>',
    };
  }
  return { ok: true, value };
}

/** Role IDs are snowflakes; empty means "do not mention anyone". */
export function validateDiscordRoleId(raw: string): FieldValidation {
  const value = raw.trim();
  if (value === '') {
    return { ok: true, value: '' };
  }
  if (!DISCORD_ROLE_ID_PATTERN.test(value)) {
    return { ok: false, error: 'The role ID must be the numeric Discord role ID (snowflake)' };
  }
  return { ok: true, value };
}

/** The same embed shape __monitor.sh sends, so a test exercises the real payload contract. */
export function buildDiscordAlertPayload(input: {
  title: string;
  description: string;
  color?: number;
  roleId?: string;
  footerText: string;
  timestamp?: string;
}): DiscordWebhookPayload {
  const payload: DiscordWebhookPayload = {
    embeds: [
      {
        title: input.title,
        description: input.description,
        color: input.color ?? DISCORD_ALERT_COLOR,
        footer: { text: input.footerText },
        timestamp: input.timestamp ?? new Date().toISOString(),
      },
    ],
  };
  const roleId = input.roleId?.trim() ?? '';
  if (roleId !== '') {
    payload.content = `<@&${roleId}>`;
  }
  return payload;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).replace(/\s+/g, ' ').trim();
    return text.slice(0, ERROR_DETAIL_LIMIT);
  } catch (error) {
    return `unreadable response body (${describeError(error)})`;
  }
}

/** Never throws: the caller needs the HTTP status, or 0 for an unreachable endpoint. */
export async function postDiscordPayload(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
): Promise<DiscordDeliveryResult> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
    });
    if (response.ok) {
      return { success: true, status: response.status };
    }
    const detail = await readErrorDetail(response);
    const suffix = detail === '' ? '' : `: ${detail}`;
    return {
      success: false,
      status: response.status,
      error: `Discord rejected the alert (HTTP ${response.status}${suffix})`,
    };
  } catch (error) {
    return {
      success: false,
      status: 0,
      error: `Could not reach the webhook endpoint (${describeError(error)})`,
    };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatTomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isSectionHeader(trimmed: string): boolean {
  return trimmed.startsWith('[') && trimmed.endsWith(']');
}

/** Cuts at the first hash where TOML starts a comment; an inline comment rode into the value otherwise. */
function readTomlScalar(rawValue: string): string {
  const quoted = rawValue.match(/^"([^"]*)"/) ?? rawValue.match(/^'([^']*)'/);
  if (quoted) return quoted[1];
  const hash = rawValue.indexOf('#');
  return (hash === -1 ? rawValue : rawValue.slice(0, hash)).trim();
}

/** Reads an unquoted value from one TOML section; returns '' when absent. */
export function readTomlValue(content: string, section: string, key: string): string {
  const lines = content.split('\n');
  const header = `[${section}]`;
  let insideSection = false;
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  for (const line of lines) {
    const trimmed = line.trim();
    if (isSectionHeader(trimmed)) {
      if (insideSection) return '';
      insideSection = trimmed === header;
      continue;
    }
    if (!insideSection || !keyPattern.test(line)) {
      continue;
    }
    const rawValue = line.slice(line.indexOf('=') + 1).trim();
    return readTomlScalar(rawValue);
  }
  return '';
}

/** config.toml is the single source of truth, so this must not touch unrelated keys. */
export function upsertTomlValue(content: string, section: string, key: string, value: string): string {
  const lines = content.split('\n');
  const header = `[${section}]`;
  const newLine = `${key} = ${formatTomlString(value)}`;
  const headerIndex = lines.findIndex((line) => line.trim() === header);

  if (headerIndex === -1) {
    const separator = content.endsWith('\n') ? '' : '\n';
    return `${content}${separator}\n${header}\n${newLine}\n`;
  }

  let sectionEnd = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (isSectionHeader(lines[i].trim())) {
      sectionEnd = i;
      break;
    }
  }

  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  for (let i = headerIndex + 1; i < sectionEnd; i += 1) {
    if (keyPattern.test(lines[i])) {
      lines[i] = newLine;
      return lines.join('\n');
    }
  }

  let insertAt = sectionEnd;
  while (insertAt > headerIndex + 1 && lines[insertAt - 1].trim() === '') {
    insertAt -= 1;
  }
  lines.splice(insertAt, 0, newLine);
  return lines.join('\n');
}
