import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

const SCOPES = ['contest', 'user', 'group'] as const;
const POLICIES = ['allow', 'deny'] as const;

type Scope = (typeof SCOPES)[number];
type Policy = (typeof POLICIES)[number];

interface PolicyInput {
  scope: Scope;
  scopeId: number;
  policy: Policy;
}

// Mirrors the Python resolution: contest beats user beats group, a deny on any group wins.
const EFFECTIVE_POLICY_SQL = `
  SELECT policy FROM (
    SELECT 1 AS prio, policy FROM username_policies WHERE scope = 'contest' AND scope_id = $1
    UNION ALL
    SELECT 2, policy FROM username_policies WHERE scope = 'user' AND scope_id = $2
    UNION ALL
    SELECT 3, CASE WHEN BOOL_OR(policy = 'deny') THEN 'deny' ELSE 'allow' END
    FROM username_policies
    WHERE scope = 'group'
      AND scope_id IN (
        SELECT group_id FROM contestant_group_memberships WHERE user_id = $2
      )
    HAVING COUNT(*) > 0
  ) t ORDER BY prio LIMIT 1`;

function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

function isPolicy(value: unknown): value is Policy {
  return typeof value === 'string' && (POLICIES as readonly string[]).includes(value);
}

function parsePolicyInput(data: Record<string, unknown>): PolicyInput | null {
  const scope = data.scope;
  const policy = data.policy;
  const scopeId = Number(data.scope_id);
  if (!isScope(scope) || !isPolicy(policy) || !Number.isInteger(scopeId)) return null;
  return { scope, scopeId, policy };
}

async function assertScopeAuthorized(scope: Scope): Promise<Response | null> {
  if (scope !== 'contest') return null;
  const contestAuthorized = await verifyApiPermission('contest:update');
  return contestAuthorized.authorized ? null : contestAuthorized.response;
}

export async function GET(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('username:policy:read');
  if (!authorized) return response;

  const contestId = Number(req.nextUrl.searchParams.get('contest_id'));
  const userId = Number(req.nextUrl.searchParams.get('user_id'));
  if (!Number.isInteger(contestId) || !Number.isInteger(userId)) {
    return apiError({ message: 'contest_id and user_id are required', status: 400 });
  }

  try {
    const rows = (await prisma.$queryRawUnsafe(
      EFFECTIVE_POLICY_SQL, contestId, userId,
    )) as Array<{ policy: string }>;
    return apiSuccess({ allowed: rows.length > 0 && rows[0].policy === 'allow' });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const { authorized, response, session } = await verifyApiPermission('username:policy:update');
  if (!authorized) return response;

  try {
    const input = parsePolicyInput(await req.json());
    if (input === null) return apiError({ message: 'Invalid policy', status: 400 });

    const notAuthorized = await assertScopeAuthorized(input.scope);
    if (notAuthorized !== null) return notAuthorized;

    await prisma.$executeRaw`
      INSERT INTO username_policies (scope, scope_id, policy, updated_at, updated_by)
      VALUES (${input.scope}::username_policy_scope, ${input.scopeId}, ${input.policy}::username_policy, now(), ${Number(session.userId)})
      ON CONFLICT (scope, scope_id) DO UPDATE
        SET policy = EXCLUDED.policy,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by`;

    await recordAudit({
      verb: 'username_policy:update',
      entity: 'username_policy',
      entityId: `${input.scope}:${input.scopeId}`,
      afterValues: { scope: input.scope, scopeId: input.scopeId, policy: input.policy },
      result: 'success',
    });
    revalidatePath('/[locale]/people/users', 'page');
    if (input.scope === 'contest') revalidatePath('/[locale]/contests', 'page');
    return apiSuccess({ scope: input.scope, scopeId: input.scopeId, policy: input.policy });
  } catch (error) {
    return apiError(error);
  }
}
