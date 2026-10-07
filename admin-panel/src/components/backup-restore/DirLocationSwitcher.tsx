'use client';

import { Tabs } from '@/components/core/Tabs';

export interface DirLocation {
    readonly id: string;
    readonly label: string;
}

interface DirLocationSwitcherProps {
    readonly locations: readonly DirLocation[];
    readonly activeId: string;
    readonly onSelect: (id: string) => void;
}

/**
 * Location tabs shared by the two Backup Dir modes. The list is config, not
 * state: whichever location is active decides which root the mode's listing,
 * preview and writes resolve against.
 */
export function DirLocationSwitcher({ locations, activeId, onSelect }: DirLocationSwitcherProps): React.JSX.Element | null {
    if (locations.length <= 1) return null;
    return (
        <Tabs
            items={locations.map((location) => ({ id: location.id, label: location.label }))}
            activeId={activeId}
            ariaLabel="Backup locations"
            onSelect={onSelect}
        />
    );
}
