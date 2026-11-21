'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { useDictionary } from '@/hooks/useDictionary';
import { apiClient } from '@/lib/apiClient';
import { withBasePath } from '@/lib/base-path';

import { BrandingCard } from './BrandingCard';

// GET needs ranking:read and POST needs ranking:update, so the card is read-only without the second.
const LOGO_URL = '/api/ranking/logo';

export function RankingLogoCard({
  canManage,
  displayName,
}: {
  canManage: boolean;
  displayName?: string;
}): React.JSX.Element {
  const toastCopy = useDictionary().toasts.ranking;
  const [logoUrl, setLogoUrl] = useState(LOGO_URL);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError('');
      try {
        const body = new FormData();
        body.append('logo', file);
        const result = await apiClient.postFormData(LOGO_URL, body);
        if (result.success) {
          // A cache-busting stamp keeps the browser from showing the image it already has.
          setLogoUrl(`${LOGO_URL}?ts=${Date.now()}`);
          toast.success(toastCopy.logoUpdatedTitle, { description: toastCopy.logoUpdatedDescription });
        } else {
          const message = result.error ?? toastCopy.uploadFailedFallback;
          setError(message);
          toast.error(toastCopy.uploadFailedTitle, { description: message });
        }
      } finally {
        setUploading(false);
      }
    },
    [toastCopy],
  );

  return (
    <BrandingCard
      previewUrl={withBasePath(logoUrl)}
      loading={uploading}
      onUpload={handleUpload}
      error={error}
      readOnly={!canManage}
      displayName={displayName}
    />
  );
}
