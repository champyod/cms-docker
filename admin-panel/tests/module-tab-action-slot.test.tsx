// @vitest-environment happy-dom
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/en/infrastructure/containers';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

import { ModuleTabShell, type ModuleTabActions } from '@/components/navigation/ModuleTabShell';
import { usePublishModuleTabActions } from '@/components/navigation/ModuleTabActionSlot';
import type { BreadcrumbItem, RouteId, RouteTab } from '@/lib/navigation/types';

// Why a sibling file rather than an added block in module-tab-shell.test.tsx: that file's
// `buildModuleTabs` cases reach `server-only`, which resolves only under the node
// environment, and a panel publishes through a layout effect, which never runs on the
// server renderer those cases use.
const INFRA_TABS: readonly RouteTab[] = [
  { id: 'infrastructure.deployments', label: 'Deployments', href: '/en/infrastructure/deployments' },
  { id: 'infrastructure.containers', label: 'Containers', href: '/en/infrastructure/containers' },
];

const BREADCRUMBS: readonly BreadcrumbItem[] = [{ label: 'Home', href: '/en' }];

const STATIC_ACTIONS = {
  'infrastructure.containers': <button type="button">Static Containers Action</button>,
} satisfies ModuleTabActions;

function SlotPanel({
  tabId,
  label,
  withdrawn = false,
}: {
  readonly tabId: RouteId;
  readonly label: string;
  readonly withdrawn?: boolean;
}): React.JSX.Element {
  const [presses, setPresses] = useState(0);
  usePublishModuleTabActions(
    tabId,
    withdrawn ? null : (
      <button type="button" onClick={() => setPresses((value) => value + 1)}>
        {label} {presses}
      </button>
    ),
  );
  return <div>Tab content</div>;
}

function shellWith(children: ReactNode): React.JSX.Element {
  return (
    <ModuleTabShell
      breadcrumbs={BREADCRUMBS}
      title="Infrastructure"
      description="Runtime state"
      tabs={INFRA_TABS}
      actionsMap={STATIC_ACTIONS}
    >
      {children}
    </ModuleTabShell>
  );
}

function headerText(index = 0): string {
  return screen.getAllByTestId('surface-header')[index]?.textContent ?? '';
}

beforeEach(() => {
  pathname = '/en/infrastructure/containers';
});

// Why: globals are disabled in vitest.config.ts, so @testing-library/react's automatic
// afterEach cleanup does not run; without it, later header queries would bind to the
// accumulated document.body.
afterEach(() => cleanup());

describe('ModuleTabShell action slot', () => {
  it('shows what the active tab published instead of the static action', () => {
    render(shellWith(<SlotPanel tabId="infrastructure.containers" label="Panel Refresh" />));
    expect(headerText()).toContain('Panel Refresh');
    expect(headerText()).not.toContain('Static Containers Action');
  });

  it('falls back to the static action for a panel that published nothing', () => {
    render(shellWith(<div>Tab content</div>));
    expect(headerText()).toContain('Static Containers Action');
  });

  it('keeps the static action out of the header while the panel publishes null', () => {
    render(
      shellWith(<SlotPanel tabId="infrastructure.containers" label="Panel Refresh" withdrawn />),
    );
    expect(headerText()).not.toContain('Panel Refresh');
    expect(headerText()).not.toContain('Static Containers Action');
  });

  it('brings the static action back when the panel stops publishing null', () => {
    const view = render(
      shellWith(<SlotPanel tabId="infrastructure.containers" label="Panel Refresh" withdrawn />),
    );
    expect(headerText()).not.toContain('Static Containers Action');
    view.rerender(shellWith(<SlotPanel tabId="infrastructure.containers" label="Panel Refresh" />));
    expect(headerText()).toContain('Panel Refresh 0');
    expect(headerText()).not.toContain('Static Containers Action');
  });

  it('republishes on every panel render so the header holds no stale closure', () => {
    render(shellWith(<SlotPanel tabId="infrastructure.containers" label="Panel Refresh" />));
    fireEvent.click(screen.getByRole('button', { name: 'Panel Refresh 0' }));
    expect(headerText()).toContain('Panel Refresh 1');
  });

  it('shows no action for a tab no panel claimed while the URL sits on it', () => {
    pathname = '/en/infrastructure/deployments';
    render(shellWith(<SlotPanel tabId="infrastructure.containers" label="Panel Refresh" />));
    expect(headerText()).not.toContain('Panel Refresh');
    expect(headerText()).not.toContain('Static Containers Action');
  });

  it('follows the URL to the tab whose panel published', () => {
    pathname = '/en/infrastructure/deployments';
    render(shellWith(<SlotPanel tabId="infrastructure.deployments" label="Panel Deploy" />));
    expect(headerText()).toContain('Panel Deploy');
  });

  it('restores the static action once the publishing panel unmounts', () => {
    const view = render(shellWith(<SlotPanel tabId="infrastructure.containers" label="Panel Refresh" />));
    expect(headerText()).toContain('Panel Refresh');
    view.rerender(shellWith(<div>Tab content</div>));
    expect(headerText()).toContain('Static Containers Action');
    expect(headerText()).not.toContain('Panel Refresh');
  });

  it('keeps two mounted shells from reading each other published actions', () => {
    render(
      <>
        {shellWith(<SlotPanel tabId="infrastructure.containers" label="First Panel Action" />)}
        {shellWith(<SlotPanel tabId="infrastructure.containers" label="Second Panel Action" />)}
      </>,
    );
    expect(headerText(0)).toContain('First Panel Action');
    expect(headerText(0)).not.toContain('Second Panel Action');
    expect(headerText(1)).toContain('Second Panel Action');
    expect(headerText(1)).not.toContain('First Panel Action');
  });
});