import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  ensurePermission: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: { readdir: mocks.readdir, readFile: mocks.readFile },
}));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/app/actions/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { readTlsState } from '@/app/actions/securityTls';

// A lineage the panel cannot read (root-owned store) must surface as unreadable, not
// take the whole TLS view down.
describe('readTlsState with an unreadable certificate store', () => {
  it('records an EACCES lineage as unreadable instead of throwing', async () => {
    mocks.ensurePermission.mockResolvedValue(new Set<string>());
    mocks.recordAudit.mockResolvedValue(undefined);
    mocks.readdir.mockResolvedValue([{ name: 'grader.example.org', isDirectory: () => true }]);
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mocks.readFile.mockRejectedValue(denied);

    const state = await readTlsState();

    expect(state.lineages).toHaveLength(0);
    expect(state.unreadableLineages).toEqual(['grader.example.org']);
  });
});
