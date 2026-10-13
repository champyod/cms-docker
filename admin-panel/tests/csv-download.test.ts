// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadCsvFile, openServerDownload } from '@/lib/csv-download';

describe('csv download helpers', () => {
  const createObjectURL = vi.fn((_blob: Blob | MediaSource): string => 'blob:users');
  const revokeObjectURL = vi.fn((_url: string): void => undefined);
  let click: ReturnType<typeof vi.spyOn>;
  let setAttribute: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation((): void => undefined);
    setAttribute = vi.spyOn(HTMLAnchorElement.prototype, 'setAttribute');
  });

  afterEach(() => {
    vi.clearAllMocks();
    click.mockRestore();
    setAttribute.mockRestore();
  });

  it('saves generated text with a BOM under the requested filename', async () => {
    downloadCsvFile('users-selected.csv', 'a,b\n1,2\n');

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toBe('\uFEFFa,b\n1,2\n');
    expect(setAttribute).toHaveBeenCalledWith('download', 'users-selected.csv');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:users');
  });

  it('opens a server-held CSV without copying its bytes or revoking the URL', () => {
    openServerDownload('/api/users/credentials/token-1', 'users-applied.csv');

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(setAttribute).toHaveBeenCalledWith('download', 'users-applied.csv');
    expect(click).toHaveBeenCalledTimes(1);
  });
});
