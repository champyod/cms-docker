// @vitest-environment happy-dom
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/en/infrastructure/containers';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

import { ModuleShell, type ModuleActions } from '@/components/navigation/ModuleShell';
import { usePublishModuleActions } from '@/components/navigation/ModuleActionSlot';
import type { ModuleFieldItem } from '@/lib/navigation/module-nav';
import type { BreadcrumbItem, RouteId } from '@/lib/navigation/types';

const INFRA_FIELDS: readonly ModuleFieldItem[] = [
  { id: 'infrastructure.deployments', label: 'Deployments', href: '/en/infrastructure/deployments' },
  { id: 'infrastructure.containers', label: 'Containers', href: '/en/infrastructure/containers' },
];

const BREADCRUMBS: readonly BreadcrumbItem[] = [{ label: 'Home', href: '/en' }];

const STATIC_ACTIONS = {
  'infrastructure.containers': <button type="button">Static Containers Action</button>,
} satisfies ModuleActions;

function SlotPanel({
  fieldId,
  label,
  withdrawn = false,
}: {
  readonly fieldId: RouteId;
  readonly label: string;
  readonly withdrawn?: boolean;
}): React.JSX.Element {
  const [presses, setPresses] = useState(0);
  usePublishModuleActions(
    fieldId,
    withdrawn ? null : (
      <button type="button" onClick={() => setPresses((value) => value + 1)}>
        {label} {presses}
      </button>
    ),
  );
  return <div>Field content</div>;
}

function shellWith(children: ReactNode): React.JSX.Element {
  return (
    <ModuleShell
      breadcrumbs={BREADCRUMBS}
      fields={INFRA_FIELDS}
      descriptions={{}}
      actionsMap={STATIC_ACTIONS}
      fallbackTitle="Infrastructure"
    >
      {children}
    </ModuleShell>
  );
}

function headerText(index = 0): string {
  return screen.getAllByTestId('surface-header')[index]?.textContent ?? '';
}

beforeEach(() => {
  pathname = '/en/infrastructure/containers';
});

// Globals are disabled in vitest.config.ts, so testing-library cleanup must run by hand.
afterEach(() => cleanup());

describe('ModuleShell action slot', () => {
  it('shows what the active field published instead of the static action', () => {
    render(shellWith(<SlotPanel fieldId="infrastructure.containers" label="Panel Refresh" />));
    expect(headerText()).toContain('Panel Refresh');
    expect(headerText()).not.toContain('Static Containers Action');
  });

  it('falls back to the static action for a field whose panel published nothing', () => {
    render(shellWith(<div>Field content</div>));
    expect(headerText()).toContain('Static Containers Action');
  });

  it('keeps the static action out of the header while the panel publishes null', () => {
    render(
      shellWith(<SlotPanel fieldId="infrastructure.containers" label="Panel Refresh" withdrawn />),
    );
    expect(headerText()).not.toContain('Panel Refresh');
    expect(headerText()).not.toContain('Static Containers Action');
  });

  it('brings the static action back when the panel stops publishing null', () => {
    const view = render(
      shellWith(<SlotPanel fieldId="infrastructure.containers" label="Panel Refresh" withdrawn />),
    );
    expect(headerText()).not.toContain('Static Containers Action');
    view.rerender(shellWith(<SlotPanel fieldId="infrastructure.containers" label="Panel Refresh" />));
    expect(headerText()).toContain('Panel Refresh 0');
    expect(headerText()).not.toContain('Static Containers Action');
  });

  it('republishes on every panel render so the header holds no stale closure', () => {
    render(shellWith(<SlotPanel fieldId="infrastructure.containers" label="Panel Refresh" />));
    fireEvent.click(screen.getByRole('button', { name: 'Panel Refresh 0' }));
    expect(headerText()).toContain('Panel Refresh 1');
  });

  it('shows no action for a field no panel claimed while the URL sits on it', () => {
    pathname = '/en/infrastructure/deployments';
    render(shellWith(<SlotPanel fieldId="infrastructure.containers" label="Panel Refresh" />));
    expect(headerText()).not.toContain('Panel Refresh');
    expect(headerText()).not.toContain('Static Containers Action');
  });

  it('follows the URL to the field whose panel published', () => {
    pathname = '/en/infrastructure/deployments';
    render(shellWith(<SlotPanel fieldId="infrastructure.deployments" label="Panel Deploy" />));
    expect(headerText()).toContain('Panel Deploy');
  });

  it('restores the static action once the publishing panel unmounts', () => {
    const view = render(shellWith(<SlotPanel fieldId="infrastructure.containers" label="Panel Refresh" />));
    expect(headerText()).toContain('Panel Refresh');
    view.rerender(shellWith(<div>Field content</div>));
    expect(headerText()).toContain('Static Containers Action');
    expect(headerText()).not.toContain('Panel Refresh');
  });

  it('keeps two mounted shells from reading each other published actions', () => {
    render(
      <>
        {shellWith(<SlotPanel fieldId="infrastructure.containers" label="First Panel Action" />)}
        {shellWith(<SlotPanel fieldId="infrastructure.containers" label="Second Panel Action" />)}
      </>,
    );
    expect(headerText(0)).toContain('First Panel Action');
    expect(headerText(0)).not.toContain('Second Panel Action');
    expect(headerText(1)).toContain('Second Panel Action');
    expect(headerText(1)).not.toContain('First Panel Action');
  });
});
