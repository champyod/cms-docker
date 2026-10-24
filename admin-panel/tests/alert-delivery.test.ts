// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deliverSystemEvent, isPanelOnScreen } from '@/lib/live/alert-delivery';
import { memoryStorage } from './memory-storage';

const device = vi.hoisted(() => ({ notifyDevice: vi.fn(), requestDeviceNotifications: vi.fn() }));
vi.mock('@/lib/live/device-notifications', () => device);

const CUE = { id: 'audit-42', title: 'Critical action: service:deploy', detail: 'Ada deployed Midterm' };

/** Whether the tab is on screen; every case states it before it delivers. */
let panelHidden = false;

beforeEach(() => {
  vi.restoreAllMocks();
  panelHidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => panelHidden });
  // Why a fresh store per case: the claim outlives a render, which is exactly what one case proves.
  vi.stubGlobal('localStorage', memoryStorage());
  device.notifyDevice.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * The one place a system event's surface is decided: the panel records every event, and exactly one
 * cue outside it, chosen by whether the operator is looking.
 */
describe('system event delivery', () => {
  it('reads the tab rather than the window focus', () => {
    expect(isPanelOnScreen()).toBe(true);
    panelHidden = true;
    expect(isPanelOnScreen()).toBe(false);
  });

  it('gives an event the panel record alone while the tab is on screen', () => {
    expect(deliverSystemEvent(CUE)).toBe('record');
    expect(device.notifyDevice).not.toHaveBeenCalled();
  });

  it('leaves the claim unwritten while the tab is on screen, so the first hidden delivery still notifies', () => {
    deliverSystemEvent(CUE);
    panelHidden = true;

    expect(deliverSystemEvent(CUE)).toBe('notification');
    expect(device.notifyDevice).toHaveBeenCalledTimes(1);
  });

  it('posts one notification for an event, and records it silently for the second tab', () => {
    panelHidden = true;

    expect(deliverSystemEvent(CUE)).toBe('notification');
    // The second call stands for a sibling tab, which shares the claim and nothing else.
    expect(deliverSystemEvent(CUE)).toBe('record');
    expect(device.notifyDevice).toHaveBeenCalledTimes(1);
  });

  it('forgets a claim once it is older than the window it is kept for', () => {
    panelHidden = true;
    vi.useFakeTimers({ now: new Date('2026-10-25T09:00:00.000Z') });
    deliverSystemEvent(CUE);
    vi.setSystemTime(new Date('2026-10-25T09:06:00.000Z'));

    expect(deliverSystemEvent(CUE)).toBe('notification');
    expect(device.notifyDevice).toHaveBeenCalledTimes(2);
  });

  it('notifies rather than swallowing the alert when the claim cannot be stored', () => {
    panelHidden = true;
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(deliverSystemEvent(CUE)).toBe('notification');
    expect(device.notifyDevice).toHaveBeenCalledTimes(1);
  });
});
