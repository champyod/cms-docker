'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { extractLocale } from '@/hooks/useShortcuts';
import { Command, CommandInput, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { logout } from '@/app/actions/auth';
import { activateContest, getAvailableContests } from '@/app/actions/contests';
import { buildEntitySearchers } from './entity-searchers';
import { useEntitySearch } from './useEntitySearch';
import { MIN_QUERY_LENGTH } from './search-scheduler';
import { buildNavVisibility } from './palette-data';
import { useDictionary } from '@/hooks/useDictionary';
import { buildShellItems } from '@/components/navigation/shell-nav';
import { buildRoute } from '@/lib/navigation/routes';
import { NavigationItems, EntityItems, ActionItems } from './CommandPaletteItems';

const PALETTE_TOGGLE_KEY = 'k';
const COMMAND_STYLING = '[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:size-5';

interface AvailableContestRow { id: number; name: string; is_active: boolean; }
interface CommandPaletteProps { open: boolean; onOpenChange: (open: boolean) => void; permissionKeys: readonly string[]; }

export function CommandPalette({ open, onOpenChange, permissionKeys }: CommandPaletteProps): React.JSX.Element {
  const router = useAppRouter();
  const pathname = usePathname();
  const locale = extractLocale(pathname ?? '');
  const dictionary = useDictionary();
  const [query, setQuery] = useState('');
  const [availableContests, setAvailableContests] = useState<AvailableContestRow[]>([]);
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const visibility = useMemo(() => buildNavVisibility(permissionKeys), [permissionKeys]);
  const navItems = useMemo(
    () => buildShellItems(effective, 'palette', locale, dictionary),
    [effective, locale, dictionary],
  );
  const searchers = useMemo(() => buildEntitySearchers(visibility, locale), [visibility, locale]);
  const { loading, hits } = useEntitySearch(open, query, searchers);
  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setQuery('');
    onOpenChange(nextOpen);
  }, [onOpenChange]);

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
  const navigateTo = useCallback((href: string) => { close(); router.push(href); }, [close, router]);

  const runSwitchContest = async (contestId: number): Promise<void> => {
    close();
    try {
      const result = await activateContest(contestId);
      if (result.success) { toast.success('Active contest switched'); router.refresh(); }
      else toast.error('Failed to switch contest', { description: result.error ?? 'Unknown error' });
    } catch { toast.error('Failed to switch contest'); }
  };

  const runSignOut = (): void => { close(); logout().catch(() => { toast.error('Sign out failed'); }); };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="overflow-hidden p-0">
        <DialogHeader className="sr-only"><DialogTitle>Command Palette</DialogTitle><DialogDescription>Type a command or search...</DialogDescription></DialogHeader>
        <Command shouldFilter={false} className={COMMAND_STYLING}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search navigation, entities, actions..." />
          <CommandList>
            <NavigationItems items={navItems} onSelect={(item) => navigateTo(item.href)} />
            <EntityItems loading={loading} hasQuery={hasQuery} hits={hits} onSelect={(hit) => navigateTo(hit.path)} />
            <ActionItems contestsEnabled={visibility.contests} availableContests={availableContests} onCreateContest={() => navigateTo(buildRoute(locale, 'contests.list'))} onSwitchContest={(contestId) => void runSwitchContest(contestId)} onSignOut={runSignOut} />
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
