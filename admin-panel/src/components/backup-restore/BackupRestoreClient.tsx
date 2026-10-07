'use client';

import { useState } from 'react';
import { ArchiveRestore, FileDown } from 'lucide-react';

import { EmptyState } from '@/components/core/EmptyState';
import { Stack } from '@/components/core/Layout';
import { Tabs } from '@/components/core/Tabs';
import { ArchiveBrowserSection } from '@/components/backup-restore/ArchiveBrowserSection';
import { BackupSelectionSection } from '@/components/backup-restore/BackupSelectionSection';
import { DirLocationSwitcher } from '@/components/backup-restore/DirLocationSwitcher';
import type { DirLocation } from '@/components/backup-restore/DirLocationSwitcher';
import { RestoreSection } from '@/components/backup-restore/RestoreSection';
import { ScheduleRunsSection } from '@/components/backup-restore/ScheduleRunsSection';
import { ScheduleSection } from '@/components/backup-restore/ScheduleSection';
import { hasEffectivePermission } from '@/lib/permission-engine';

type ModeTabId = 'from-file' | 'to-file' | 'from-dir' | 'to-dir' | 'schedules';

interface ModeTab {
    readonly id: ModeTabId;
    readonly label: string;
    /** One key the reader must hold; a tab they cannot act inside is not offered. */
    readonly anyOf: readonly string[];
    readonly showsLocationSwitcher: boolean;
}

const MODE_TABS: readonly ModeTab[] = [
    { id: 'from-file', label: 'From File', anyOf: ['backup:restore'], showsLocationSwitcher: false },
    { id: 'to-file', label: 'To File', anyOf: ['backup:create'], showsLocationSwitcher: false },
    { id: 'from-dir', label: 'From Backup Dir', anyOf: ['backup:restore', 'backup:list', 'backup:delete'], showsLocationSwitcher: true },
    { id: 'to-dir', label: 'To Backup Dir', anyOf: ['backup:create'], showsLocationSwitcher: true },
    { id: 'schedules', label: 'Schedules', anyOf: ['backup:schedule', 'backup:settle'], showsLocationSwitcher: false },
];

interface BackupRestoreClientProps {
    readonly permissionKeys: readonly string[];
    readonly locations: readonly DirLocation[];
    readonly defaultLocationId: string;
}

export function BackupRestoreClient({
    permissionKeys,
    locations,
    defaultLocationId,
}: BackupRestoreClientProps): React.JSX.Element {
    const effective = new Set(permissionKeys);
    const visibleTabs = MODE_TABS.filter((tab) => tab.anyOf.some((key) => hasEffectivePermission(effective, key)));
    const [activeTabId, setActiveTabId] = useState<ModeTabId>(visibleTabs[0]?.id ?? 'from-file');
    const [activeLocationId, setActiveLocationId] = useState(defaultLocationId);
    // A selective dump starts detached, so the archive browser is told to look again rather
    // than showing the pre-run list until the operator presses Refresh.
    const [archiveRefreshToken, setArchiveRefreshToken] = useState(0);
    const activeTab = visibleTabs.find((tab) => tab.id === activeTabId) ?? visibleTabs[0];

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
            <Tabs
                items={visibleTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
                activeId={activeTab.id}
                ariaLabel="Backup and restore modes"
                onSelect={(id) => setActiveTabId(id as ModeTabId)}
            />
            {activeTab.showsLocationSwitcher && (
                <DirLocationSwitcher locations={locations} activeId={activeLocationId} onSelect={setActiveLocationId} />
            )}

            {activeTab.id === 'from-file' && <RestoreSection />}

            {activeTab.id === 'to-file' && (
                <EmptyState
                    icon={FileDown}
                    title="Save tables to a file"
                    description="Pick catalog tables and download the dump through the browser; nothing is kept on the server."
                />
            )}

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
