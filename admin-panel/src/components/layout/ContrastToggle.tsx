'use client';

import { Contrast } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { useContrast } from '@/hooks/useContrast';

/**
 * One control, two states: normal and high contrast.
 *
 * It is a pressed toggle rather than a cycle, because the choice is on or off and a person who
 * needs it should be able to read the state from the button itself.
 */
export function ContrastToggle(): React.JSX.Element {
  const { preference, toggle } = useContrast();

  if (preference === null) {
    return (
      <Button variant="ghost" size="sm" iconOnly tooltip="High contrast" onClick={toggle}>
        <span className="flex" suppressHydrationWarning>
          <Contrast className="size-4" aria-hidden />
        </span>
      </Button>
    );
  }

  const on = preference === 'high';

  return (
    <Button
      variant={on ? 'secondary' : 'ghost'}
      size="sm"
      iconOnly
      aria-pressed={on}
      tooltip={on ? 'High contrast on' : 'High contrast off'}
      onClick={toggle}
    >
      <Contrast className="size-4" aria-hidden />
      <span className="sr-only">{on ? 'High contrast on. Activate to turn it off.' : 'High contrast off. Activate to turn it on.'}</span>
    </Button>
  );
}
