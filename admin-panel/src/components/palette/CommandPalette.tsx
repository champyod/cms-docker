'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { extractLocale } from '@/hooks/useShortcuts';
import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/core/Command';
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/core/Dialog';
import { toast } from 'sonner';
import { getAvailableContests } from '@/app/actions/contests';
import { useDeployContest } from '@/hooks/useDeployContest';
import { hasEffectivePermission, ACTION_PERMISSIONS } from '@/lib/permission-engine';
import { buildEntitySearchers } from './entity-searchers';
import { useEntitySearch } from './useEntitySearch';
import { MIN_QUERY_LENGTH } from './search-scheduler';
import { buildNavVisibility } from './palette-data';
import { filterPaletteRows, normalizeQuery } from './palette-filter';
import { useDictionary } from '@/hooks/useDictionary';
import type { ShellNavItem } from '@/components/navigation/shell-nav';
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
  const { deploy } = useDeployContest();
  const canDeploy = useMemo(
    () => hasEffectivePermission(new Set(permissionKeys), ACTION_PERMISSIONS.deployContest),
    [permissionKeys],
  );
  const navItems = useMemo(
    () => buildShellItems(effective, 'palette', locale, dictionary),
    [effective, locale, dictionary],
  );
  const searchers = useMemo(() => buildEntitySearchers(visibility, locale), [visibility, locale]);
  const { loading, hits } = useEntitySearch(open, query, searchers);
  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;
  const needle = normalizeQuery(query);
  const visibleNavItems = useMemo(
    () => filterPaletteRows<ShellNavItem>(navItems, needle, (item) => item.label),
    [navItems, needle],
  );

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setQuery('');
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open || !canDeploy) return;
    let cancelled = false;
    getAvailableContests().then((result) => { if (!cancelled && result.success) setAvailableContests(result.contests); }).catch(() => { if (!cancelled) setAvailableContests([]); });
    return () => { cancelled = true; };
  }, [open, canDeploy]);

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

  const runSwitchContest = (contestId: number): void => {
    close();
    // Why the deploy and not a bare flag write: switching the active contest must also sync
    // config.toml/.env and recreate the contest stack, or the running stack keeps serving the old one.
    void deploy(contestId);
  };

  // Why: the route handler owns both the cookie clear and the locale-correct redirect, so the
  // palette hands off to it instead of posting a Server Action from the page it is leaving.
  // The destination is built from the frozen registry so the sign-out URL has one owner.
  const runSignOut = (): void => {
    close();
    try {
      router.push(buildRoute(locale, 'auth.signout'));
    } catch {
      toast.error('Sign out failed');
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="overflow-hidden p-0">
        <DialogHeader className="sr-only"><DialogTitle>Command Palette</DialogTitle><DialogDescription>Type a command or search...</DialogDescription></DialogHeader>
        <Command shouldFilter={false} className={COMMAND_STYLING}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search navigation, entities, actions..." />
          <CommandList>
            {visibleNavItems.length > 0 && (
              <NavigationItems items={visibleNavItems} onSelect={(item) => navigateTo(item.href)} />
            )}
            <EntityItems loading={loading} hasQuery={hasQuery} hits={hits} onSelect={(hit) => navigateTo(hit.path)} />
            <ActionItems contestsEnabled={visibility.contests} canDeploy={canDeploy} availableContests={availableContests} needle={needle} onCreateContest={() => navigateTo(buildRoute(locale, 'contests.list'))} onSwitchContest={(contestId) => runSwitchContest(contestId)} onSignOut={runSignOut} />
            <CommandEmpty>No matching commands.</CommandEmpty>
          </CommandList>
        </Command>
      </DialogContent>
    </DialogRoot>
  );
}
