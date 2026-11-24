'use client';

import { motion } from 'motion/react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { useTheme } from '@/hooks/useTheme';
import { nextThemePreference, type ThemePreference } from '@/lib/theme';

const LABEL: Record<ThemePreference, string> = {
  system: 'Follow system',
  light: 'Light',
  dark: 'Dark',
};

const ICON: Record<ThemePreference, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/** The icon shows the choice itself, or follow-system and light look identical whenever the OS is light. */
export function ThemeToggle(): React.JSX.Element {
  const { preference, cyclePreference } = useTheme();

  // Placeholder while the preference is unresolved; the real icon renders after mount.
  if (preference === null) {
    return (
      <Button variant="ghost" size="sm" iconOnly tooltip="Switch theme" onClick={cyclePreference}>
        <span className="flex" suppressHydrationWarning>
          <Monitor className="size-4" aria-hidden />
        </span>
      </Button>
    );
  }

  const Icon = ICON[preference];
  const upcoming = LABEL[nextThemePreference(preference)];

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      tooltip={`Theme: ${LABEL[preference]}: switch to ${upcoming.toLowerCase()}`}
      onClick={cyclePreference}
    >
      <motion.span
        key={preference}
        initial={{ rotate: -90, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0.38, 0.9] }}
        className="flex"
      >
        <Icon className="size-4" aria-hidden />
        <span className="sr-only">{`Theme: ${LABEL[preference]}. Activate for ${upcoming.toLowerCase()}.`}</span>
      </motion.span>
    </Button>
  );
}
