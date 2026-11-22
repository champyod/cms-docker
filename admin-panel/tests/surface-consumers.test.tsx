// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ContestTasksSection } from '@/components/contests/contest-detail/ContestTasksSection';
import { ContestParticipantsSection } from '@/components/contests/contest-detail/ContestParticipantsSection';
import { ContestModalShell } from '@/components/contests/contest-modal/ContestModalShell';
import { ContestSettingsSection } from '@/components/contests/contest-detail/ContestSettingsSection';
import { MismatchBanner } from '@/components/deployments/MismatchBanner';
import { UnsavedRestartBanner } from '@/components/settings/UnsavedRestartBanner';
import { EnvSectionCard } from '@/components/settings/EnvSectionCard';
import type { EnvConfigSection } from '@/components/settings/envConfigSections';
import en from '@/dictionaries/en.json';

afterEach(() => cleanup());

const SETTINGS_FORM = {
  name: 'Autumn',
  description: 'Regional round',
  timezone: 'Asia/Bangkok',
  allow_questions: true,
  allow_user_tests: true,
  submissions_download_allowed: false,
  allow_password_authentication: false,
  allow_registration: true,
  analysis_enabled: false,
};

// Why these assertions and not snapshots: each one pins that a consumer reached
// a shared primitive instead of re-declaring the same markup, so re-inlining the
// duplicate fails here rather than shipping a second look.
describe('detail sections render through SectionCard', () => {
  it('renders the task rows with their actions and no section header of its own', () => {
    const props = {
      contestId: 7,
      tasks: [{ id: 3, name: 'sum', title: 'Sum' }],
      locale: 'en',
      permissionKeys: ['task:update'] as readonly string[],
      copy: en,
      onAddTask: () => undefined,
      onAttachTasks: () => undefined,
      onRemoveTask: () => undefined,
      onRefresh: () => undefined,
    };
    const html = renderToStaticMarkup(<ContestTasksSection {...props} />);
    expect(html).toContain('Add Task');
    expect(html).toContain('Remove sum');
    expect(html).not.toContain('aria-expanded');
  });

  it('marks the participant section collapsed and shows the gated invite actions when expanded', () => {
    const html = renderToStaticMarkup(
      <ContestParticipantsSection
        participations={[]}
        expanded
        permissionKeys={['participation:create']}
        onToggle={() => undefined}
        onAddParticipant={() => undefined}
        onAddTeam={() => undefined}
        onMarkAsTest={() => undefined}
        onOpenSettings={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Add Participant');
    expect(html).toContain('No participants yet');
  });

  it('renders the settings group body without a second section header', () => {
    const html = renderToStaticMarkup(<ContestSettingsSection formData={SETTINGS_FORM} onChange={() => undefined} />);
    expect(html).toContain('Timezone');
    expect(html).toContain('Asia/Bangkok');
    expect(html).not.toContain('Contest Settings');

    render(<ContestSettingsSection formData={SETTINGS_FORM} canEdit={false} onChange={() => undefined} />);
    expect(screen.getByPlaceholderText('Asia/Bangkok').hasAttribute('disabled')).toBe(true);
  });
});

describe('row action clusters render through RowActions', () => {
  // Why a reader, not the markup: every gate here is a per-action permission, so the
  // contract is which control a given key set reaches.
  function participantRow(permissionKeys: readonly string[]): void {
    render(
      <ContestParticipantsSection
        participations={[{ id: 4, user_id: 2, unrestricted: false, hidden: false, users: { username: 'ada', first_name: 'Ada', last_name: 'L' } }]}
        expanded
        permissionKeys={permissionKeys}
        onToggle={() => undefined}
        onAddParticipant={() => undefined}
        onAddTeam={() => undefined}
        onMarkAsTest={() => undefined}
        onOpenSettings={() => undefined}
        onRemove={() => undefined}
      />,
    );
  }

  it('gates the participation editor on the permission its save action demands', () => {
    participantRow(['participation:update']);
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark as Test User' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove ada' })).toBeNull();
  });

  // Why each key alone: a reader holding only one of the two must reach exactly that
  // control, and Settings must follow its own action rather than a sibling's gate.
  it('gives a delete-only reader remove alone, and a reader with neither key no cluster', () => {
    participantRow(['participation:delete']);
    expect(screen.queryByRole('button', { name: 'Remove ada' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark as Test User' })).toBeNull();
    cleanup();
    participantRow(['participation:read']);
    expect(screen.queryByRole('group', { name: 'Participants' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('wraps the environment save pair in a labelled group and hides the restart until a field changes', () => {
    const section: EnvConfigSection = {
      title: 'Database Configuration',
      filename: 'config.toml',
      fields: [{ key: 'POSTGRES_DB', tomlSection: 'core', label: 'Database Name' }],
    };
    const unchanged = renderToStaticMarkup(
      <EnvSectionCard
        section={section}
        data={{ 'config.toml': { POSTGRES_DB: 'cms' } }}
        originalData={{ 'config.toml': { POSTGRES_DB: 'cms' } }}
        saving={false}
        hasPendingRestarts
        onPersist={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(unchanged).toContain('role="group"');
    expect(unchanged).toContain('aria-label="Database Configuration"');
    expect(unchanged).toContain('aria-label="Save Only"');
    expect(unchanged).not.toContain('aria-label="Save &amp; Restart"');

    const changed = renderToStaticMarkup(
      <EnvSectionCard
        section={section}
        data={{ 'config.toml': { POSTGRES_DB: 'other' } }}
        originalData={{ 'config.toml': { POSTGRES_DB: 'cms' } }}
        saving={false}
        hasPendingRestarts
        onPersist={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    expect(changed).toContain('aria-label="Save &amp; Restart"');
  });
});

describe('warning strips render through InlineAlert', () => {
  it('keeps the configuration mismatch polite, since the page found it on arrival', () => {
    const html = renderToStaticMarkup(
      <MismatchBanner activeContestId={12} activeContestName="Autumn" dbActiveContestId={10} containerContestId={10} boundContestSource={null} />,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('Configuration Mismatch');
  });

  it('announces the pending restarts and keeps every service named', () => {
    const html = renderToStaticMarkup(<UnsavedRestartBanner services={['api', 'worker']} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Unsaved Changes Require Restart');
    expect(html).toContain('api');
    expect(html).toContain('worker');
  });
});

describe('the contest modal renders through ModalFooter', () => {
  it('submits the contest form from the footer and keeps cancel separate', () => {
    render(
      <ContestModalShell
        contest={null}
        onClose={() => undefined}
        loading={false}
        error=""
        validationErrors={new Map()}
        activeTab="general"
        setActiveTab={() => undefined}
        onSubmit={() => undefined}
      >
        <p>Body</p>
      </ContestModalShell>,
    );
    const confirm = screen.getByRole('button', { name: 'Create Contest' });
    expect(confirm.getAttribute('type')).toBe('submit');
    expect(confirm.getAttribute('form')).toBe('contest-form');
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeNull();
  });

  it('lists the validation failures in a destructive alert', () => {
    render(
      <ContestModalShell
        contest={null}
        onClose={() => undefined}
        loading={false}
        error=""
        validationErrors={new Map([['name', 'Name is required']])}
        activeTab="general"
        setActiveTab={() => undefined}
        onSubmit={() => undefined}
      >
        <p>Body</p>
      </ContestModalShell>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Please fix the following 1 errors before saving:');
    expect(alert.textContent).toContain('Name is required');
  });
});
