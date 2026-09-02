'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { buildLocaleHref, extractLocale } from '@/hooks/useShortcuts';
import { Command, CommandInput, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '../providers/ToastProvider';
import { getCurrentUser, logout } from '@/app/actions/auth';
import { activateContest, getAvailableContests } from '@/app/actions/contests';
import { buildEntitySearchers } from './entity-searchers';
import { useEntitySearch } from './useEntitySearch';
import { MIN_QUERY_LENGTH } from './search-scheduler';
import { buildNavVisibility, filterNavItems, type PalettePermissions } from './palette-data';
import { NavigationItems, EntityItems, ActionItems } from './CommandPaletteItems';

const PALETTE_TOGGLE_KEY = 'k';
const COMMAND_STYLING = '[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:size-5';

interface AvailableContestRow { id: number; name: string; is_active: boolean; }
interface CommandPaletteProps { open: boolean; onOpenChange: (open: boolean) => void; }

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const locale = extractLocale(pathname ?? '');
  const { addToast } = useToast();
  const [query, setQuery] = useState('');
  const [permissions, setPermissions] = useState<PalettePermissions | null>(null);
  const [availableContests, setAvailableContests] = useState<AvailableContestRow[]>([]);
  const visibility = useMemo(() => buildNavVisibility(permissions), [permissions]);
  const navItems = filterNavItems(visibility);
  const searchers = useMemo(() => buildEntitySearchers(visibility), [visibility]);
  const { loading, hits } = useEntitySearch(open, query, searchers);
  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setQuery('');
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open || permissions !== null) return;
    let cancelled = false;
    getCurrentUser().then((user) => { if (!cancelled) setPermissions(user); }).catch(() => { if (!cancelled) setPermissions(null); });
    return () => { cancelled = true; };
  }, [open, permissions]);

  useEffect(() => {
    if (!open || !visibility.contests) return;
    let cancelled = false;
    getAvailableContests().then((result) => { if (!cancelled && result.success) setAvailableContests(result.contests); }).catch(() => { if (!cancelled) setAvailableContests([]); });
    return () => { cancelled = true; };
  }, [open, visibility.contests]);

  const openRef = useRef(open);
  const toggleRef = useRef(handleOpenChange);
  useEffect(() => { openRef.current = open; toggleRef.current = handleOpenChange; });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === PALETTE_TOGGLE_KEY) {
        event.preventDefault();
        toggleRef.current(!openRef.current);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { document.querySelector<HTMLInputElement>('[data-slot="command-input"]')?.focus(); }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const close = useCallback(() => handleOpenChange(false), [handleOpenChange]);
  const navigateTo = useCallback((path: string) => { close(); router.push(buildLocaleHref(locale, path)); }, [close, locale, router]);

  const runSwitchContest = async (contestId: number): Promise<void> => {
    close();
    try {
      const result = await activateContest(contestId);
      if (result.success) { addToast({ type: 'success', title: 'Active contest switched' }); router.refresh(); }
      else addToast({ type: 'error', title: 'Failed to switch contest', message: result.error ?? 'Unknown error' });
    } catch { addToast({ type: 'error', title: 'Failed to switch contest' }); }
  };

  const runSignOut = (): void => { close(); logout().catch(() => { addToast({ type: 'error', title: 'Sign out failed' }); }); };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="overflow-hidden p-0">
        <DialogHeader className="sr-only"><DialogTitle>Command Palette</DialogTitle><DialogDescription>Type a command or search...</DialogDescription></DialogHeader>
        <Command shouldFilter={false} className={COMMAND_STYLING}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search navigation, entities, actions..." />
          <CommandList>
            <NavigationItems items={navItems} onSelect={(item) => navigateTo(item.path)} />
            <EntityItems loading={loading} hasQuery={hasQuery} hits={hits} onSelect={(hit) => navigateTo(hit.path)} />
            <ActionItems contestsEnabled={visibility.contests} availableContests={availableContests} onCreateContest={() => navigateTo('/contests')} onSwitchContest={(contestId) => void runSwitchContest(contestId)} onSignOut={runSignOut} />
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
