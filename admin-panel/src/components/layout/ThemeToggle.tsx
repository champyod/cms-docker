'use client';

import { motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle(): React.JSX.Element {
  const { theme, toggleTheme } = useTheme();
  // Placeholder while the theme is unresolved; the real icon renders after mount.
  if (theme === null) {
    return (
      <Button variant="ghost" size="sm" iconOnly tooltip="Switch theme" onClick={toggleTheme}>
        <span className="flex" suppressHydrationWarning>
          <Moon className="size-4" aria-hidden />
        </span>
      </Button>
    );
  }
  const isDark = theme === 'dark';
  const Icon = isDark ? Sun : Moon;

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      tooltip={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={toggleTheme}
    >
      <motion.span
        key={isDark ? 'sun' : 'moon'}
        initial={{ rotate: -90, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="flex"
      >
        <Icon className="size-4" aria-hidden />
      </motion.span>
    </Button>
  );
}
