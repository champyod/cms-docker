'use client';

import { useCallback, useRef } from 'react';

import { Loader2 } from 'lucide-react';

import { Card } from '@/components/core/Card';
import { useToast } from '@/components/providers/ToastProvider';
import { cn } from '@/lib/utils';

const ACCEPTED_TYPES = '.png,.jpg,.jpeg,.gif,.bmp';

interface BrandingCardProps {
  previewUrl: string;
  loading: boolean;
  onUpload: (file: File) => Promise<void>;
  error?: string;
}

function PreviewImage({ previewUrl, onClick }: { previewUrl: string; onClick: () => void }) {
  if (!previewUrl) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex h-32 w-full items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20 text-sm text-muted-foreground transition-colors hover:border-white/20 hover:text-white"
      >
        No ranking logo — click to upload
      </button>
    );
  }

  return (
    <button type="button" onClick={onClick} className="flex w-full justify-center rounded-xl bg-black/20 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="Ranking logo" src={previewUrl} className="max-h-32 w-auto object-contain" />
    </button>
  );
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30 backdrop-blur-sm">
      <Loader2 className="h-8 w-8 animate-spin text-white" aria-label="Uploading" />
    </div>
  );
}

export function BrandingCard({ previewUrl, loading, onUpload, error }: BrandingCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  const handleClick = useCallback(() => {
    if (loading) return;
    inputRef.current?.click();
  }, [loading]);

  const handleChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      event.target.value = '';
      try {
        await onUpload(file);
      } catch (err) {
        const message = (err as Error).message || 'Upload failed';
        addToast({ type: 'error', title: 'Upload failed', message });
      }
    },
    [addToast, onUpload],
  );

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-white">Ranking Branding</h2>
        <p className="text-xs text-muted-foreground">Click the preview to upload a new ranking logo. Accepted: png, jpg, jpeg, gif, bmp (max 5MB).</p>
      </div>

      <div className="relative">
        <div className={cn('transition-all', loading && 'blur-sm pointer-events-none')}>
          <PreviewImage previewUrl={previewUrl} onClick={handleClick} />
        </div>
        {loading && <LoadingOverlay />}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={handleChange} aria-hidden />
    </Card>
  );
}
