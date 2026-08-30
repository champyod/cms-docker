import { prisma } from '@/lib/prisma';
import { formatStoredPassword, type PasswordKind } from '@/lib/password-format';

const MAX_IP_ENTRIES = 50;
const CIDR_PATTERN = /^(\d{1,3}\.){3}\d{1,3}(\/(3[0-2]|[12]?\d))?$/;

export interface UpdateParticipationInput {
  team_id?: number | null;
  hidden?: boolean;
  unrestricted?: boolean;
  password?: string | null;
  /** Storage mode for `password`; defaults to 'plaintext' (legacy CMS validator requires the prefix). */
  passwordKind?: PasswordKind;
  extra_time_seconds?: number;
  delay_time_seconds?: number;
  ip?: string;
  starting_time?: string | null;
}

interface ParticipationDetailsRow {
  id: number;
  contest_id: number;
  user_id: number;
  team_id: number | null;
  hidden: boolean;
  unrestricted: boolean;
  delay_time_seconds: number | null;
  extra_time_seconds: number | null;
  starting_time: Date | string | null;
  ip_string: string | null;
}

export interface ParticipationDetails {
  id: number;
  contest_id: number;
  user_id: number;
  team_id: number | null;
  hidden: boolean;
  unrestricted: boolean;
  delay_time_seconds: number;
  extra_time_seconds: number;
  starting_time: string;
  ip_string: string;
}

export function parseIpAllowlist(raw: string | undefined): { validIps: string[]; error?: string } {
  if (!raw) return { validIps: [] };

  const entries = raw.split(',').map(ip => ip.trim()).filter(ip => ip.length > 0);
  if (entries.length > MAX_IP_ENTRIES) {
    return { validIps: [], error: `Too many IP entries (max ${MAX_IP_ENTRIES})` };
  }

  const validIps = entries.filter(ip => {
    if (!CIDR_PATTERN.test(ip)) return false;
    const addr = ip.split('/')[0] ?? '';
    return addr.split('.').every(octet => Number(octet) <= 255);
  });
  return { validIps };
}

/** Raw SQL is required here: interval and cidr columns have no Prisma scalar mapping. */
export async function executeParticipationUpdate(
  participationId: number,
  data: UpdateParticipationInput,
  validIps: string[]
): Promise<void> {
  const ipClause = validIps.length > 0
    ? `ARRAY[${validIps.map((_, idx) => `$${idx + 9}::cidr`).join(',')}]`
    : 'NULL';
  const storedPassword = data.password
    ? await formatStoredPassword(data.passwordKind ?? 'plaintext', data.password)
    : null;
  const params: unknown[] = [
    data.team_id ?? null,
    data.hidden ?? false,
    data.unrestricted ?? false,
    (data.extra_time_seconds ?? 0).toString(),
    (data.delay_time_seconds ?? 0).toString(),
    storedPassword,
    data.starting_time ? new Date(data.starting_time) : null,
    participationId,
    ...validIps,
  ];

  await prisma.$executeRawUnsafe(`
    UPDATE participations SET
      team_id = $1,
      hidden = $2,
      unrestricted = $3,
      extra_time = ($4 || ' seconds')::interval,
      delay_time = ($5 || ' seconds')::interval,
      password = $6,
      starting_time = $7,
      ip = ${ipClause}
    WHERE id = $8
  `, ...params);
}

export async function queryParticipationDetails(id: number): Promise<ParticipationDetailsRow | null> {
  const result = await prisma.$queryRaw<ParticipationDetailsRow[]>`
    SELECT
      id, contest_id, user_id, team_id,
      hidden, unrestricted,
      EXTRACT(EPOCH FROM delay_time)::int as delay_time_seconds,
      EXTRACT(EPOCH FROM extra_time)::int as extra_time_seconds,
      starting_time,
      array_to_string(ip, ', ') as ip_string
    FROM participations
    WHERE id = ${id}
  `;
  return result[0] ?? null;
}
