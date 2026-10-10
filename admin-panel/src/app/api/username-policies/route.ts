import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

const SCOPES = ['contest', 'user', 'group'] as const;
const POLICIES = ['allow', 'deny'] as const;

// WHY one statement: the resolution mirrors the Python side
// (src/cms/db/username.py resolve_username_config) — the contest
// policy beats the user policy, which beats the user's group
// policies, where a deny on any group wins; with no policy set
// anywhere the feature stays denied.
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

export async function GET(req: NextRequest) {
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

export async function PUT(req: NextRequest) {
  const { authorized, response, session } = await verifyApiPermission('username:policy:update');
  if (!authorized) return response;

  try {
    const data = await req.json();
    const scope = data.scope;
    const scopeId = Number(data.scope_id);
    const policy = data.policy;
    if (!SCOPES.includes(scope) || !POLICIES.includes(policy)
        || !Number.isInteger(scopeId)) {
      return apiError({ message: 'Invalid policy', status: 400 });
    }
    // WHY the contest scope additionally demands contest:update:
    // it configures the feature for a whole contest, so the
    // caller must hold the contest's own update key as well.
    if (scope === 'contest') {
      const contestAuthorized = await verifyApiPermission('contest:update');
      if (!contestAuthorized.authorized) return contestAuthorized.response;
    }

    await prisma.$executeRaw`
      INSERT INTO username_policies (scope, scope_id, policy, updated_at, updated_by)
      VALUES (${scope}::username_policy_scope, ${scopeId}, ${policy}::username_policy, now(), ${Number(session.userId)})
      ON CONFLICT (scope, scope_id) DO UPDATE
        SET policy = EXCLUDED.policy,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by`;

    await recordAudit({
      verb: 'username_policy:update',
      entity: 'username_policy',
      entityId: `${scope}:${scopeId}`,
      afterValues: { scope, scopeId, policy },
      result: 'success',
    });
    revalidatePath('/[locale]/people/users', 'page');
    if (scope === 'contest') revalidatePath('/[locale]/contests', 'page');
    return apiSuccess({ scope, scopeId, policy });
  } catch (error) {
    return apiError(error);
  }
}
