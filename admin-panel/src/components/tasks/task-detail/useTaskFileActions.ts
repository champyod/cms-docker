'use client';

import { useState } from 'react';
import { useTaskTabRefresh } from './useTaskTabRefresh';

export function useTaskFileActions(): {
  isAttachmentModalOpen: boolean;
  setIsAttachmentModalOpen: (open: boolean) => void;
  refresh: () => void;
} {
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = useState(false);
  const refresh = useTaskTabRefresh();
  return { isAttachmentModalOpen, setIsAttachmentModalOpen, refresh };
}
