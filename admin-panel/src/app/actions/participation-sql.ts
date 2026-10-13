import { prisma } from '@/lib/prisma';
import { formatStoredPassword, type PasswordKind } from '@/lib/password-format';
import { zoneWallClockToInstant } from '@/lib/timezone';

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
  timezone: string | null;
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

  for (const ip of entries) {
    if (!CIDR_PATTERN.test(ip)) {
      return { validIps: [], error: `Invalid IP or CIDR: ${ip}` };
    }
    const [addr = '', mask = ''] = ip.split('/');
    const octets = addr.split('.').map(Number);
    if (!octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
      return { validIps: [], error: `Invalid IP or CIDR: ${ip}` };
    }
    // Why reject here: Postgres throws 22P02 on misaligned masks
    // (10.10.0.0/10), so fail at the form with the network address named.
    if (mask !== '') {
      const bits = Number(mask);
      const addrInt = octets.reduce((acc, octet) => acc * 256 + octet, 0) >>> 0;
      const maskInt = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((addrInt & maskInt) >>> 0 !== addrInt) {
        const net = [24, 16, 8, 0].map(shift => (addrInt & maskInt) >>> shift & 255).join('.');
        return { validIps: [], error: `Misaligned CIDR ${ip}: use ${net}/${bits}` };
      }
    }
  }
  return { validIps: entries };
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
  // Why the zone is resolved before the write: starting_time arrives as a wall clock in the
  // participation's own contest zone, so the contest row is read first and the wall clock is
  // converted to the instant it names. A gap or repeat wall clock throws here, before any SQL.
  const startingTime = data.starting_time
    ? zoneWallClockToInstant(data.starting_time, await resolveContestZone(participationId))
    : null;
  const params: unknown[] = [
    data.team_id ?? null,
    data.hidden ?? false,
    data.unrestricted ?? false,
    (data.extra_time_seconds ?? 0).toString(),
    (data.delay_time_seconds ?? 0).toString(),
    storedPassword,
    startingTime,
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

/** The contest zone a participation's wall clocks are read in; empty when the contest has none. */
async function resolveContestZone(participationId: number): Promise<string> {
  const row = await prisma.participations.findUnique({
    where: { id: participationId },
    select: { contests: { select: { timezone: true } } },
  });
  return row?.contests?.timezone ?? '';
}

export async function queryParticipationDetails(id: number): Promise<ParticipationDetailsRow | null> {
  const result = await prisma.$queryRaw<ParticipationDetailsRow[]>`
    SELECT
      p.id, p.contest_id, p.user_id, p.team_id,
      p.hidden, p.unrestricted,
      EXTRACT(EPOCH FROM p.delay_time)::int as delay_time_seconds,
      EXTRACT(EPOCH FROM p.extra_time)::int as extra_time_seconds,
      p.starting_time,
      array_to_string(p.ip, ', ') as ip_string,
      c.timezone
    FROM participations p
    JOIN contests c ON c.id = p.contest_id
    WHERE p.id = ${id}
  `;
  return result[0] ?? null;
}
