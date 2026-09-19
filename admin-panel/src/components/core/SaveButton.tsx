'use client';

import { useEffect, useRef } from 'react';
import { Save } from 'lucide-react';
import { CheckIcon, type CheckIconHandle } from 'lucide-animated';
import { Button, type ButtonSize, type ButtonVariantInput } from '@/components/core/Button';

interface SaveButtonProps {
  saving: boolean;
  justSaved: boolean;
  idleLabel: string;
  savedLabel?: string;
  savingLabel?: string;
  variant?: ButtonVariantInput;
  size?: ButtonSize;
  disabled?: boolean;
  onClick: () => void;
}

export function SaveButton({
  saving,
  justSaved,
  idleLabel,
  savedLabel = 'Saved',
  savingLabel = 'Saving...',
  variant = 'positive',
  size,
  disabled,
  onClick,
}: SaveButtonProps): React.JSX.Element {
  const checkRef = useRef<CheckIconHandle>(null);

  useEffect(() => {
    if (justSaved && !saving) checkRef.current?.startAnimation();
  }, [justSaved, saving]);

  return (
    <Button
      variant={variant}
      size={size}
      loading={saving}
      disabled={disabled}
      onClick={onClick}
      icon={justSaved && !saving ? undefined : Save}
    >
      {justSaved && !saving ? (
        <span className="inline-flex items-center gap-2">
          <CheckIcon ref={checkRef} size={16} animateOnHover={false} className="shrink-0" />
          {savedLabel}
        </span>
      ) : saving ? (
        savingLabel
      ) : (
        idleLabel
      )}
    </Button>
  );
}
