'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { getFileByDigest } from '@/app/actions/statements';
import { Button } from '@/components/core/Button';
import { useDictionary } from '@/hooks/useDictionary';
import { decodeFileBytes, detectFileEncoding } from '@/lib/file-encoding';

interface StoredFile {
  readonly filename: string;
  readonly digest: string;
}

export function saveDownloadedFile(filename: string, data: string): void {
  const anchor = document.createElement('a');
  anchor.href = 'data:application/octet-stream;base64,' + data;
  anchor.download = filename;
  anchor.click();
}

export function decodeBase64Source(data: string): string {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return decodeFileBytes(bytes, detectFileEncoding(bytes));
}

function useFileTransfer(file: StoredFile): {
  readonly busy: 'download' | 'copy' | null;
  readonly download: () => Promise<void>;
  readonly copy: () => Promise<void>;
} {
  const copy = useDictionary().submissions.record.source;
  const [busy, setBusy] = useState<'download' | 'copy' | null>(null);

  const readBytes = async (): Promise<string | null> => {
    const content = await getFileByDigest(file.digest);
    if (content === null) {
      toast.error(copy.noContents);
      return null;
    }
    return content.data;
  };

  const download = async (): Promise<void> => {
    setBusy('download');
    try {
      const data = await readBytes();
      if (data !== null) saveDownloadedFile(file.filename, data);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : copy.noContents);
    } finally {
      setBusy(null);
    }
  };

  const copyText = async (): Promise<void> => {
    setBusy('copy');
    try {
      const data = await readBytes();
      if (data === null) return;
      await navigator.clipboard.writeText(decodeBase64Source(data));
      toast.success(copy.copied);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : copy.copyFailed);
    } finally {
      setBusy(null);
    }
  };

  return { busy, download, copy: copyText };
}

export function SubmissionFileActions({ file }: { readonly file: StoredFile }): React.JSX.Element {
  const source = useDictionary().submissions.record.source;
  const { busy, download, copy } = useFileTransfer(file);
  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="ghost" size="sm" disabled={busy !== null} loading={busy === 'download'} onClick={() => void download()}>
        {source.download}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy !== null} loading={busy === 'copy'} onClick={() => void copy()}>
        {source.copy}
      </Button>
    </span>
  );
}
