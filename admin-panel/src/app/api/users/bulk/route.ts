import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { cleanupExpiredCreds, csvEscape, writeCredsCsv } from '@/lib/creds-file';
import { resolveTeamIdByCode } from '@/lib/teams';
import {
  prepareRow,
  shouldGeneratePassword,
  type BulkUserRow,
  type GenerationMode,
  type PreparedRow,
} from './bulkRowPreparation';

interface BulkOutcome {
  created: Array<{ rowIndex: number; username: string; plainPassword?: string }>;
  failed: Array<{ rowIndex: number; reason: string }>;
}

const BCRYPT_SALT_ROUNDS = 10;
const BCRYPT_PREFIX = 'bcrypt:';

async function createUserWithParticipation(prepared: PreparedRow, contestId: number): Promise<void> {
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  const hash = await bcrypt.hash(prepared.plainPassword, salt);

  const user = await prisma.users.create({
    data: {
      first_name: prepared.firstName,
      last_name: prepared.lastName,
      username: prepared.username,
      email: prepared.email || null,
      password: `${BCRYPT_PREFIX}${hash}`,
      timezone: prepared.timezone || null,
      preferred_languages: [],
    },
  });

  if (!contestId) return;

  const teamId = prepared.teamCode ? await resolveTeamIdByCode(prepared.teamCode) : null;

  await prisma.$executeRaw`
    INSERT INTO participations (contest_id, user_id, team_id, hidden, unrestricted, delay_time, extra_time)
    VALUES (${contestId}, ${user.id}, ${teamId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
    ON CONFLICT (contest_id, user_id) DO NOTHING
  `;
}

async function processBulkRow(
  row: BulkUserRow,
  index: number,
  generationMode: GenerationMode,
  contestId: number,
  seenUsernames: Set<string>,
  outcome: BulkOutcome
): Promise<void> {
  const prepared = await prepareRow(row, index + 2, generationMode, contestId, seenUsernames);
  if ('reason' in prepared) {
    outcome.failed.push({ rowIndex: prepared.rowIndex, reason: prepared.reason });
    return;
  }

  try {
    await createUserWithParticipation(prepared, contestId);
  } catch (error) {
    const e = error as { code?: string; message?: string };
    if (e.code === 'P2002') {
      outcome.failed.push({ rowIndex: prepared.rowIndex, reason: `username already exists: ${prepared.username}` });
    } else {
      outcome.failed.push({ rowIndex: prepared.rowIndex, reason: e.message || 'unknown error' });
    }
    return;
  }

  outcome.created.push({
    rowIndex: prepared.rowIndex,
    username: prepared.username,
    plainPassword: shouldGeneratePassword(generationMode) && !prepared.hadExplicitPassword ? prepared.plainPassword : undefined,
  });
}

async function processBulkRows(rows: BulkUserRow[], generationMode: GenerationMode, contestId: number): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { created: [], failed: [] };
  const seenUsernames = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    await processBulkRow(rows[index], index, generationMode, contestId, seenUsernames, outcome);
  }

  return outcome;
}

async function buildBulkResponse(outcome: BulkOutcome) {
  if (outcome.created.length === 0) {
    return apiSuccess({ success: true, count: 0, failed: outcome.failed });
  }

  const credsRows = outcome.created.filter((c) => c.plainPassword);
  if (credsRows.length > 0) {
    const lines = ['row_index,username,password'];
    for (const c of credsRows) {
      lines.push(`${c.rowIndex},${csvEscape(c.username)},${csvEscape(c.plainPassword ?? '')}`);
    }
    const { downloadUrl } = await writeCredsCsv(`${lines.join('\n')}\n`);
    return apiSuccess({
      createdCount: outcome.created.length,
      failedCount: outcome.failed.length,
      downloadUrl,
      count: credsRows.length,
      failed: outcome.failed,
    });
  }

  return apiSuccess({
    createdCount: outcome.created.length,
    failedCount: outcome.failed.length,
    failed: outcome.failed,
  });
}

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  await cleanupExpiredCreds();

  try {
    const body = await req.json();
    const rows: BulkUserRow[] = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length === 0) {
      return apiError({ message: 'No rows provided', status: 400 });
    }

    const generationMode: GenerationMode = body?.generationMode ?? 'none';
    const contestId = Number(body?.contestId || 0);
    const outcome = await processBulkRows(rows, generationMode, contestId);

    revalidatePath('/[locale]/users', 'page');
    if (contestId) {
      revalidatePath('/[locale]/contests', 'page');
    }

    return buildBulkResponse(outcome);
  } catch (error) {
    return apiError(error);
  }
}
