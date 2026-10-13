// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/en/infrastructure/containers' }));
vi.mock('@/app/actions/docker', () => ({
  controlContainer: vi.fn(),
  fetchContainerLogs: vi.fn(),
  getContainerLogs: vi.fn(),
  runCompose: vi.fn(),
}));
vi.mock('@/app/actions/containerConfig', () => ({
  getContainerConfig: vi.fn(),
  resetRestartCount: vi.fn(),
  syncContainerConfigWithDocker: vi.fn().mockResolvedValue({ success: true }),
  updateContainerConfig: vi.fn(),
}));
vi.mock('@/app/actions/services', () => ({
  analyzeContainerDependencies: vi.fn().mockResolvedValue([]),
  analyzeRestartRequirements: vi.fn().mockResolvedValue({ requiredRestarts: [] }),
}));
vi.mock('@/lib/discord-notifier', () => ({
  getDiscordWebhookStatus: vi.fn().mockResolvedValue({ configured: true }),
}));

import { ContainersClient } from '@/components/containers/ContainersClient';
import { DictionaryProvider } from '@/components/providers/DictionaryProvider';
import type { ContainerInfo, ContainersFrame } from '@/lib/live-frames';
import en from '@/dictionaries/en.json';

/**
 * Why the surface and not a prop: the zeros were never a formatting bug — the grid was rendered from
 * an empty list while the first frame was still being built.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  close(): void { this.readyState = 2; }
}

const RESTART_CONFIG = { autoRestart: false, maxRestarts: 5, currentRestarts: 0, discordNotifications: true };

function container(id: string, name: string, state: string): ContainerInfo {
  return { id, name, image: 'alpine', status: 'Up 1 hour', state, created: 'now', isCmsContainer: true, protected: false };
}

const FRAME: ContainersFrame = {
  containers: [container('aaa', 'cms-database', 'running'), container('bbb', 'cms-log-service', 'exited')],
  restartCounts: { aaa: 0, bbb: 0 },
  config: { aaa: RESTART_CONFIG, bbb: RESTART_CONFIG },
};

function surface(): React.JSX.Element {
  return (
    <DictionaryProvider dict={en}>
      <ContainersClient />
    </DictionaryProvider>
  );
}

function deliver(frame: ContainersFrame): void {
  act(() => {
    FakeEventSource.instances.at(-1)?.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(frame) }),
    );
  });
}

/** The number a stat card states: its value sits immediately before its label. */
function statValue(label: string): string | null {
  return screen.getByText(label).previousElementSibling?.textContent ?? null;
}

function bodyText(): string {
  return document.body.textContent ?? '';
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('containers stat grid', () => {
  it('states no count at all before the first frame lands', () => {
    render(surface());

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(screen.queryByText(en.containers.stats.total)).toBeNull();
    expect(screen.queryAllByText('0')).toHaveLength(0);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('keeps the system log from naming a fleet size it has not been told', () => {
    render(surface());

    expect(bodyText()).not.toContain('Monitoring 0 containers');
    expect(screen.queryByText(/Monitoring \d+ containers/)).toBeNull();

    deliver(FRAME);
    expect(screen.getByText('[INFO] Monitoring 2 containers')).not.toBeNull();
  });

  it('states the counts the frame carried, once it carried them', () => {
    render(surface());
    deliver(FRAME);

    expect(statValue(en.containers.stats.total)).toBe('2');
    expect(statValue(en.containers.stats.running)).toBe('1');
    expect(statValue(en.containers.stats.stopped)).toBe('1');
  });

  it('renders the same pending grid when the page is server-rendered', () => {
    const html = renderToStaticMarkup(surface());

    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain(`>0<`);
    expect(html).not.toContain('Monitoring 0 containers');
  });
});
