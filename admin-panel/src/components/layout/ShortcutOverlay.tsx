'use client';

import type { ReactNode } from 'react';
import { Dialog } from '@/components/core/Dialog';
import { NAVIGATION_BINDINGS, useShortcuts } from '@/hooks/useShortcuts';

export interface ShortcutOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 select-none items-center justify-center rounded border border-border bg-muted px-1 font-mono text-xs font-semibold text-muted-foreground">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </span>
    </div>
  );
}

function ShortcutGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function ShortcutOverlay({ open, onOpenChange }: ShortcutOverlayProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Press ? anywhere to toggle this list."
      className="sm:max-w-xl"
    >
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <ShortcutGroup title="General">
          <ShortcutRow keys={['?']} label="Toggle shortcut list" />
          <ShortcutRow keys={['⌘', 'K']} label="Command palette" />
          <ShortcutRow keys={['Esc']} label="Close dialog" />
        </ShortcutGroup>
        <ShortcutGroup title="Lists">
          <ShortcutRow keys={['j']} label="Select next row" />
          <ShortcutRow keys={['k']} label="Select previous row" />
          <ShortcutRow keys={['Enter']} label="Open selected row" />
        </ShortcutGroup>
      </div>
      <ShortcutGroup title="Go to — press g, then key">
        <div className="grid gap-x-8 sm:grid-cols-2">
          {NAVIGATION_BINDINGS.map((binding) => (
            <ShortcutRow
              key={binding.key}
              keys={['g', binding.key.toUpperCase()]}
              label={binding.label}
            />
          ))}
        </div>
      </ShortcutGroup>
    </Dialog>
  );
}

export function ShortcutLayer() {
  const { isOverlayOpen, closeOverlay } = useShortcuts();
  return (
    <ShortcutOverlay
      open={isOverlayOpen}
      onOpenChange={(next) => {
        if (!next) closeOverlay();
      }}
    />
  );
}
