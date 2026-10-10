'use client';

import { Check, LogOut, PlusCircle, Repeat } from 'lucide-react';
import { CommandGroup, CommandItem } from '@/components/core/Command';
import type { ShellNavItem } from '@/components/navigation/shell-nav';
import type { EntityHit } from '@/components/palette/entity-searchers';
import { filterPaletteRows, labelMatches } from './palette-filter';

const SWITCH_CONTEST_LIMIT = 5;

export function NavigationItems({
  items,
  onSelect,
}: {
  items: readonly ShellNavItem[];
  onSelect: (item: ShellNavItem) => void;
}): React.JSX.Element {
  return (
    <CommandGroup heading="Navigation">
      {items.map((item) => (
        <CommandItem key={item.id} value={`nav-${item.id}`} onSelect={() => onSelect(item)}>
          <item.icon className="text-muted-foreground" />
          <span>{item.label}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

export function EntityItems({ loading, hasQuery, hits, onSelect }: { loading: boolean; hasQuery: boolean; hits: EntityHit[]; onSelect: (hit: EntityHit) => void }): React.JSX.Element {
  return (
    <CommandGroup heading="Entities">
      {loading && <p className="px-2 py-1.5 text-xs text-muted-foreground">Searching...</p>}
      {!loading && hasQuery && hits.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No matching entities.</p>}
      {!loading && hits.map((hit) => (
        <CommandItem key={hit.key} value={hit.key} onSelect={() => onSelect(hit)}>
          <span className="flex-1 truncate">{hit.label}</span>
          {hit.detail && <span className="text-xs text-muted-foreground">{hit.detail}</span>}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

export function ActionItems({ contestsEnabled, availableContests, needle, onCreateContest, onSwitchContest, onSignOut }: { contestsEnabled: boolean; availableContests: { id: number; name: string; is_active: boolean }[]; needle: string; onCreateContest: () => void; onSwitchContest: (contestId: number) => void; onSignOut: () => void }): React.JSX.Element | null {
  const contestRows = filterPaletteRows(availableContests, needle, (contest) => contest.name).slice(0, SWITCH_CONTEST_LIMIT);
  const showCreateContest = contestsEnabled && labelMatches('Create Contest', needle);
  const showSignOut = labelMatches('Sign Out', needle);

  if (!showCreateContest && !showSignOut && contestRows.length === 0) return null;

  return (
    <CommandGroup heading="Actions">
      {showCreateContest && (
        <CommandItem value="action-create-contest" onSelect={onCreateContest}>
          <PlusCircle className="text-muted-foreground" />
          <span>Create Contest</span>
        </CommandItem>
      )}
      {contestRows.map((contest) => (
        <CommandItem key={`action-switch-${contest.id}`} value={`action-switch-contest-${contest.id}`} onSelect={() => onSwitchContest(contest.id)}>
          {contest.is_active ? <Check /> : <Repeat className="text-muted-foreground" />}
          <span>{contest.is_active ? `Active: ${contest.name}` : `Switch to ${contest.name}`}</span>
        </CommandItem>
      ))}
      {showSignOut && (
        <CommandItem value="action-sign-out" onSelect={onSignOut}>
          <LogOut className="text-muted-foreground" />
          <span>Sign Out</span>
        </CommandItem>
      )}
    </CommandGroup>
  );
}
