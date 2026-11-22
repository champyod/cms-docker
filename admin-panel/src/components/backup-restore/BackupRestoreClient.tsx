'use client';

import { useState } from 'react';
import { ArchiveRestore } from 'lucide-react';

import { EmptyState } from '@/components/core/EmptyState';
import { Stack } from '@/components/core/Layout';
import { ArchiveBrowserSection } from '@/components/backup-restore/ArchiveBrowserSection';
import { BackupSelectionSection } from '@/components/backup-restore/BackupSelectionSection';
import { DirLocationSwitcher } from '@/components/backup-restore/DirLocationSwitcher';
import type { DirLocation } from '@/components/backup-restore/DirLocationSwitcher';
import { RestoreSection } from '@/components/backup-restore/RestoreSection';
import { SaveToFileFlow } from '@/components/backup-restore/SaveToFileFlow';
import { ScheduleRunsSection } from '@/components/backup-restore/ScheduleRunsSection';
import { ScheduleSection } from '@/components/backup-restore/ScheduleSection';
import { BACKUP_MODES, type BackupModeId } from '@/lib/backup/modes';
import { hasEffectivePermission } from '@/lib/permission-engine';

interface BackupRestoreClientProps {
    readonly permissionKeys: readonly string[];
    readonly locations: readonly DirLocation[];
    readonly defaultLocationId: string;
    /** Which workflow the address asks for; the layout renders the switcher. */
    readonly activeMode: BackupModeId;
}

export function BackupRestoreClient({
    permissionKeys,
    locations,
    defaultLocationId,
    activeMode,
}: BackupRestoreClientProps): React.JSX.Element {
    const effective = new Set(permissionKeys);
    const visibleTabs = BACKUP_MODES.filter((tab) => tab.anyOf.some((key) => hasEffectivePermission(effective, key)));
    const [activeLocationId, setActiveLocationId] = useState(defaultLocationId);
    // A selective dump starts detached, so the archive browser is told to look again rather
    // than showing the pre-run list until the operator presses Refresh.
    const [archiveRefreshToken, setArchiveRefreshToken] = useState(0);
    const activeTab = visibleTabs.find((tab) => tab.id === activeMode) ?? visibleTabs[0];

    if (activeTab === undefined) {
        return (
            <EmptyState
                icon={ArchiveRestore}
                title="No backup access"
                description="This account holds none of the backup permissions the page needs."
            />
        );
    }

    return (
        <Stack gap={6}>
            {activeTab.showsLocationSwitcher && (
                <DirLocationSwitcher locations={locations} activeId={activeLocationId} onSelect={setActiveLocationId} />
            )}

            {activeTab.id === 'from-file' && <RestoreSection />}

            {activeTab.id === 'to-file' && <SaveToFileFlow />}

            {activeTab.id === 'from-dir' && (
                <ArchiveBrowserSection refreshToken={archiveRefreshToken} locationId={activeLocationId} />
            )}

            {activeTab.id === 'to-dir' && (
                <BackupSelectionSection
                    onBackupComplete={() => setArchiveRefreshToken((token) => token + 1)}
                    locationId={activeLocationId}
                />
            )}

            {activeTab.id === 'schedules' && (
                <>
                    <ScheduleSection />
                    <ScheduleRunsSection />
                </>
            )}
        </Stack>
    );
}
