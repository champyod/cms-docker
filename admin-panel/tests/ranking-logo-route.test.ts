import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  recordAudit: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  chmod: vi.fn(),
  rm: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('@/lib/api-utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-utils')>('@/lib/api-utils');
  return { ...actual, verifyApiPermission: mocks.verifyApiPermission };
});
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('fs/promises', () => ({ default: mocks }));

import { getRepoRoot } from '@/lib/repo-root';
import { POST as uploadLogo } from '@/app/api/ranking/logo/route';

const RANKING_DIR = '/var/local/lib/cms/ranking';
const HOST_DIR = path.join(getRepoRoot(), 'config/assets');

function logoRequest(): NextRequest {
  const formData = new FormData();
  formData.append('logo', new File([new Uint8Array(4)], 'logo.png'));
  return new NextRequest('http://localhost/api/ranking/logo', { method: 'POST', body: formData });
}

function refusal(dir: string): Error & { code: string; syscall: string; path: string } {
  return Object.assign(new Error(`EACCES: permission denied, mkdir '${dir}'`), {
    code: 'EACCES',
    syscall: 'mkdir',
    path: dir,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: '1' } });
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.chmod.mockResolvedValue(undefined);
  mocks.rm.mockResolvedValue(undefined);
  mocks.access.mockResolvedValue(undefined);
  mocks.stat.mockResolvedValue({ mtime: new Date() });
  mocks.readFile.mockResolvedValue('[admin]\nRANKING_LOGO_PATH = ""\n');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('POST /api/ranking/logo', () => {
  it('writes the logo to the volume and the mirror, then reports the mirror path', async () => {
    const response = await uploadLogo(logoRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.ext).toBe('png');
    expect(mocks.mkdir).toHaveBeenCalledWith(RANKING_DIR, { recursive: true });
    expect(mocks.mkdir).toHaveBeenCalledWith(HOST_DIR, { recursive: true });
  });

  it('names the volume path and errno when the write is refused', async () => {
    mocks.mkdir.mockRejectedValue(refusal(RANKING_DIR));

    const response = await uploadLogo(logoRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain('EACCES');
    expect(body.error).toContain(RANKING_DIR);
  });

  it('names the host bind path when the mirror is refused', async () => {
    mocks.mkdir.mockImplementation(async (dir: string) => {
      if (dir === HOST_DIR) throw refusal(HOST_DIR);
    });

    const response = await uploadLogo(logoRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain(HOST_DIR);
  });
});
