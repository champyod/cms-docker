'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftIcon, EarthIcon, MaximizeIcon, MinimizeIcon, type EarthIconHandle } from 'lucide-animated';
import {
  COUNTDOWN_THRESHOLD_UNITS,
  listTimezones,
  zoneOffsetLabel,
  zoneOffsetMap,
  type CountdownThreshold,
  type CountdownThresholdUnit,
} from '@/lib/contest-countdown';
import { cn } from '@/lib/utils';

// The list runs to hundreds of zones, so a search box beats scrolling all of them.
const MAX_VISIBLE_RESULTS = 200;

const ICON_BUTTON_CLASSES =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-input bg-transparent px-3 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  hasPopup?: boolean;
  expanded?: boolean;
}

/** Toolbar button wrapping a lucide-animated icon, which renders a div rather than an svg. */
export const CountdownIconButton = memo(function CountdownIconButton({
  label,
  onClick,
  children,
  className,
  hasPopup,
  expanded,
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-haspopup={hasPopup ? 'listbox' : undefined}
      aria-expanded={hasPopup ? expanded : undefined}
      className={cn(ICON_BUTTON_CLASSES, className)}
    >
      {children}
    </button>
  );
});

interface TimezoneMenuProps {
  value: string;
  onChange: (timeZone: string) => void;
}
export const ContestCountdownTimezoneMenu = memo(function ContestCountdownTimezoneMenu({
  value,
  onChange,
}: TimezoneMenuProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<EarthIconHandle>(null);

  const zones = listTimezones();
  // Guarded on isOpen: the offset map needs one formatter per zone, so it is built on first open.
  const offsets = isOpen ? zoneOffsetMap() : null;

  const needle = query.trim().toLowerCase();
  const matched = useMemo(
    () => (needle ? zones.filter((zone) => zone.toLowerCase().includes(needle)) : zones),
    [zones, needle],
  );
  const visible = matched.slice(0, MAX_VISIBLE_RESULTS);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggle = (): void => {
    iconRef.current?.startAnimation();
    setQuery('');
    setIsOpen((open) => !open);
  };

  return (
    <div ref={containerRef} className="relative">
      <CountdownIconButton label="Select timezone" onClick={toggle} hasPopup expanded={isOpen}>
        <EarthIcon ref={iconRef} size={18} animateOnHover />
        <span className="tabular-nums">{zoneOffsetLabel(value)}</span>
      </CountdownIconButton>
      <AnimatePresence>
        {isOpen ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="absolute right-0 z-20 mt-2 w-72 origin-top rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
          >
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${zones.length} timezones`}
              aria-label="Search timezone"
              className="mb-2 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
            <ul role="listbox" aria-label="Timezone" className="max-h-64 overflow-auto">
              {visible.map((zone) => (
                <li key={zone}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={zone === value}
                    onClick={() => {
                      onChange(zone);
                      setIsOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                      zone === value && 'bg-accent text-accent-foreground',
                    )}
                  >
                    <span className="truncate">{zone}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{offsets?.get(zone) ?? ''}</span>
                  </button>
                </li>
              ))}
              {visible.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">No zone matches that search.</li>
              ) : null}
            </ul>
            {matched.length > visible.length ? (
              <p className="px-3 pt-2 text-xs text-muted-foreground">Keep typing to narrow {matched.length} matches.</p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});

const THRESHOLD_UNIT_LABELS: Readonly<Record<CountdownThresholdUnit, string>> = {
  seconds: 'sec',
  minutes: 'min',
  hours: 'hr',
  percent: '%',
};

interface ThresholdFieldProps {
  threshold: CountdownThreshold;
  onChange: (next: CountdownThreshold) => void;
}

/** Asks for the hurry window on the page itself: an amount plus sec/min/hr/%. */
export const CountdownThresholdField = memo(function CountdownThresholdField({
  threshold,
  onChange,
}: ThresholdFieldProps): React.JSX.Element {
  const changeAmount = (event: React.ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...threshold, amount: event.target.valueAsNumber });
  };
  const changeUnit = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const unit = COUNTDOWN_THRESHOLD_UNITS.find((candidate) => candidate === event.target.value);
    if (unit) onChange({ ...threshold, unit });
  };
  return (
    <label className="countdown-threshold" title="Warn me this far ahead">
      <span className="sr-only">Hurry warning window</span>
      <input
        type="number"
        min={1}
        inputMode="numeric"
        value={Number.isFinite(threshold.amount) ? threshold.amount : ''}
        onChange={changeAmount}
        className="countdown-threshold-input"
      />
      <select value={threshold.unit} onChange={changeUnit} className="countdown-threshold-unit">
        {COUNTDOWN_THRESHOLD_UNITS.map((unit) => (
          <option key={unit} value={unit}>{THRESHOLD_UNIT_LABELS[unit]}</option>
        ))}
      </select>
    </label>
  );
});

interface ToolbarProps {
  onBack: () => void;
  threshold: CountdownThreshold;
  onThresholdChange: (next: CountdownThreshold) => void;
  timezone: string;
  onTimezoneChange: (timeZone: string) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

/** Page chrome: leave, warn window, zone, full screen. */
export const CountdownToolbar = memo(function CountdownToolbar({
  onBack,
  threshold,
  onThresholdChange,
  timezone,
  onTimezoneChange,
  isFullscreen,
  onToggleFullscreen,
}: ToolbarProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CountdownIconButton label="Back" onClick={onBack}>
        <ArrowLeftIcon size={18} animateOnHover />
      </CountdownIconButton>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CountdownThresholdField threshold={threshold} onChange={onThresholdChange} />
        <ContestCountdownTimezoneMenu value={timezone} onChange={onTimezoneChange} />
        <CountdownIconButton label={isFullscreen ? 'Exit full screen' : 'Full screen'} onClick={onToggleFullscreen}>
          {isFullscreen ? <MinimizeIcon size={18} animateOnHover /> : <MaximizeIcon size={18} animateOnHover />}
        </CountdownIconButton>
      </div>
    </div>
  );
});
