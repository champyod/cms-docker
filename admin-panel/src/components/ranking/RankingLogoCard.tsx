'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { useDictionary } from '@/hooks/useDictionary';

import { BrandingCard } from './BrandingCard';

// The route the service serves the logo from. GET needs ranking:read, POST needs
// ranking:update, so the card is read-only without the second.
const LOGO_URL = '/api/ranking/logo';

/**
 * The logo keeps its own card because it is the one part of the old ranking screen that
 * still works: the service reads the logo from the volume this upload writes, while the
 * scoreboard it used to poll is served by the service itself now.
 */
export function RankingLogoCard({ canManage }: { canManage: boolean }): React.JSX.Element {
  const dict = useDictionary();
  const toastCopy = dict.toasts.ranking;
  const [logoUrl, setLogoUrl] = useState(LOGO_URL);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError("");
      try {
        const body = new FormData();
        body.append("logo", file);
        const response = await fetch(LOGO_URL, { method: "POST", body });
        if (!response.ok) {
          throw new Error(toastCopy.uploadFailedFallback);
        }
        // A cache-busting stamp keeps the browser from showing the image it already has.
        setLogoUrl(`${LOGO_URL}?ts=${Date.now()}`);
        toast.success(toastCopy.logoUpdatedTitle, { description: toastCopy.logoUpdatedDescription });
      } catch (uploadError) {
        const message = (uploadError as Error).message;
        setError(message);
        toast.error(toastCopy.uploadFailedTitle, { description: message });
      } finally {
        setUploading(false);
      }
    },
    [toastCopy],
  );

  return (
    <BrandingCard
      previewUrl={logoUrl}
      loading={uploading}
      onUpload={handleUpload}
      error={error}
      readOnly={!canManage}
    />
  );
}

