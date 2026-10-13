'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { EarthIcon, type EarthIconHandle } from 'lucide-animated';
import { listTimezones, zoneOffsetLabel, zoneOffsetMap } from '@/lib/contest-countdown';
import { resolvePanelPlacement, type PanelPlacement } from '@/lib/anchored-panel';
import { CountdownIconButton } from './CountdownIconButton';
import { usePortalHost } from './usePortalHost';
import { cn } from '@/lib/utils';

// The list runs to hundreds of zones, so a search box beats scrolling all of them.
const MAX_VISIBLE_RESULTS = 200;

/*
 * The panel's box, mirrored from its stylesheet rule: the panel is placed by the click that
 * opens it, and reading its size back would cost an extra render before it could be shown.
 * The height is the bound the list's own max height gives the panel, not the height it
 * happens to take with the matches of the moment.
 */
const PANEL_WIDTH_PX = 320;
const PANEL_HEIGHT_PX = 336;

/** Where the open panel is drawn, in window coordinates. It is fixed, so fullscreen cannot clip it. */
function resolveMenuPlacement(anchor: HTMLElement): PanelPlacement {
  const rect = anchor.getBoundingClientRect();
  return resolvePanelPlacement({
    anchor: { right: rect.right, bottom: rect.bottom },
    panelWidth: PANEL_WIDTH_PX,
    panelHeight: PANEL_HEIGHT_PX,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
}

/** A placement is only worth a render when it actually moved. */
function samePlacement(first: PanelPlacement | null, second: PanelPlacement | null): boolean {
  if (!first || !second) return first === second;
  return first.top === second.top && first.left === second.left;
}

interface TimezoneMenuProps {
  value: string;
  onChange: (timeZone: string) => void;
}
export const ContestCountdownTimezoneMenu = memo(function ContestCountdownTimezoneMenu({
  value,
  onChange,
}: TimezoneMenuProps): React.JSX.Element {
  const host = usePortalHost();
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);
  const [query, setQuery] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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

  // While it is open the panel tracks its control, so a scroll or a resize cannot leave it behind.
  useEffect(() => {
    if (!isOpen) return;
    const follow = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const next = resolveMenuPlacement(anchor);
      setPlacement((current) => (samePlacement(current, next) ? current : next));
    };
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      const isOnAnchor = anchorRef.current?.contains(target) ?? false;
      const isOnPanel = panelRef.current?.contains(target) ?? false;
      if (!isOnAnchor && !isOnPanel) setIsOpen(false);
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

  // Placement is read from the live control before the panel opens, so it is never seen elsewhere.
  const toggle = useCallback((): void => {
    iconRef.current?.startAnimation();
    setQuery('');
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const anchor = anchorRef.current;
    if (anchor) setPlacement(resolveMenuPlacement(anchor));
    setIsOpen(true);
  }, [isOpen]);

  return (
    <div ref={anchorRef} className="relative">
      <CountdownIconButton label="Select timezone" onClick={toggle} hasPopup expanded={isOpen}>
        <EarthIcon ref={iconRef} size={18} animateOnHover />
        <span className="tabular-nums">{zoneOffsetLabel(value)}</span>
      </CountdownIconButton>
      {host ? createPortal(
        <AnimatePresence>
          {isOpen && placement ? (
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              style={{ top: placement.top, left: placement.left }}
              className="countdown-zone-panel origin-top-right rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
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
        </AnimatePresence>,
        host,
      ) : null}
    </div>
  );
});
