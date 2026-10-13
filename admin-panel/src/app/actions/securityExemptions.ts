'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/app/actions/auth';
import type { BlocksActionResult } from '@/app/actions/securityBlocks';
import { recordAudit } from '@/lib/audit';
import { ensurePermission } from '@/lib/permissions';
import { endActiveBlocks, listActiveLoginExemptions, recordBlock, type SecurityBlock } from '@/lib/security/block-ledger';
import { exemptionIdentity, type ExemptionScope } from '@/lib/security/exemption-scopes';
import { exemptionError } from '@/lib/security/exemption-validation';

// A permanent exemption, unlike unlock, is a standing "never police this identity"
// record: a ledger row that stays active until an operator revokes it. The panel
// and the web servers both read it, so the account or address stops being locked
// out or challenged at every surface, not just here. Only async functions may be
// exported from a 'use server' file, so the scope vocabulary lives in
// lib/security/exemption-scopes.
const BLOCKS_PAGE_PATH = '/[locale]/security/blocks';

export async function readLoginExemptions(): Promise<readonly SecurityBlock[]> {
  await ensurePermission('security:read');
  await ensurePermission('lockout:read');
  return listActiveLoginExemptions();
}

/** Records a permanent exemption. Unlike an unlock, nothing here can be re-earned. */
export async function grantLoginExemption(scope: ExemptionScope, username: string, ip: string, reason: string): Promise<BlocksActionResult> {
  await ensurePermission('lockout:exempt');
  if (reason.trim().length === 0) return { success: false, error: 'A reason is required to exempt an account or address' };
  const invalid = exemptionError(scope, username, ip);
  if (invalid !== null) return { success: false, error: invalid };
  const identity = exemptionIdentity(scope, username, ip);
  const admin = await getCurrentUser();
  await recordBlock({
    kind: 'login_exemption',
    source: 'app',
    ip: identity.ip,
    subject: identity.subject,
    detail: { scope, reason },
    // No expiry: this is the permanent lift, so only a revoke closes it.
    expiresAt: null,
  });
  await recordAudit({
    verb: 'lockout:exempt',
    entity: 'security',
    entityId: `${identity.subject ?? '*'}@${identity.ip ?? '*'}`,
    afterValues: { scope, subject: identity.subject, ip: identity.ip, by: admin?.id ?? 0 },
    reason,
    result: 'success',
  });
  revalidatePath(BLOCKS_PAGE_PATH, 'page');
  return { success: true, message: 'Permanent exemption recorded; that identity is no longer locked out.' };
}

export async function revokeLoginExemption(subject: string, ip: string, reason: string): Promise<BlocksActionResult> {
  await ensurePermission('lockout:exempt');
  if (reason.trim().length === 0) return { success: false, error: 'A reason is required to revoke an exemption' };
  const admin = await getCurrentUser();
  const closed = await endActiveBlocks(
    { kind: 'login_exemption', subject: subject.length === 0 ? null : subject, ip: ip.length === 0 ? null : ip },
    admin?.id ?? 0,
  );
  await recordAudit({
    verb: 'lockout:exempt:revoke',
    entity: 'security',
    entityId: `${subject || '*'}@${ip || '*'}`,
    afterValues: { closed },
    reason,
    result: 'success',
  });
  revalidatePath(BLOCKS_PAGE_PATH, 'page');
  return { success: closed > 0, message: closed > 0 ? 'Exemption revoked.' : 'No live exemption for that identity.' };
}
