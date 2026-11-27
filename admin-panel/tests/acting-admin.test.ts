import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveRequestActor: vi.fn() }));

vi.mock('@/lib/db-actor-request', () => ({ resolveRequestActor: mocks.resolveRequestActor }));

import { NOT_AUTHENTICATED, resolveActingAdminId } from '@/lib/server/acting-admin';

/**
 * The administrator an authoring write is signed by.
 *
 * Why a system actor is refused: attribution means a human wrote it. A scheduled job or a CLI
 * holds no administrator and no panel session, so letting its identity through would put a name
 * on a row that no person signed.
 */
describe('resolveActingAdminId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the id the session names', async () => {
    mocks.resolveRequestActor.mockResolvedValue({ kind: 'admin', id: 12 });

    await expect(resolveActingAdminId()).resolves.toBe(12);
  });

  it('returns null when the request carries no session', async () => {
    mocks.resolveRequestActor.mockResolvedValue(null);

    await expect(resolveActingAdminId()).resolves.toBeNull();
  });

  it('returns null for a system actor', async () => {
    mocks.resolveRequestActor.mockResolvedValue({ kind: 'system', name: 'scheduler' });

    await expect(resolveActingAdminId()).resolves.toBeNull();
  });

  it('offers one refusal message for every authoring action', () => {
    expect(NOT_AUTHENTICATED).toBe('Not authenticated');
  });
});
