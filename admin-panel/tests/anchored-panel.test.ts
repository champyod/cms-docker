import { describe, expect, it } from 'vitest';
import {
  PANEL_GAP_PX,
  VIEWPORT_MARGIN_PX,
  resolvePanelPlacement,
} from '@/lib/anchored-panel';

const VIEWPORT = { viewportWidth: 1280, viewportHeight: 800 };
const PANEL = { panelWidth: 320, panelHeight: 336 };

describe('resolvePanelPlacement', () => {
  it('drops the panel directly under the anchor, right-aligned to it', () => {
    const placement = resolvePanelPlacement({
      anchor: { right: 900, bottom: 200 },
      ...PANEL,
      ...VIEWPORT,
    });
    expect(placement).toEqual({ top: 200 + PANEL_GAP_PX, left: 900 - PANEL.panelWidth });
  });

  it('keeps the panel inside the right edge when the anchor is near it', () => {
    const placement = resolvePanelPlacement({
      anchor: { right: 1280, bottom: 100 },
      ...PANEL,
      ...VIEWPORT,
    });
    expect(placement.left).toBe(VIEWPORT.viewportWidth - PANEL.panelWidth - VIEWPORT_MARGIN_PX);
  });

  it('keeps the panel inside the left edge for an anchor at the left', () => {
    const placement = resolvePanelPlacement({
      anchor: { right: 20, bottom: 100 },
      ...PANEL,
      ...VIEWPORT,
    });
    expect(placement.left).toBe(VIEWPORT_MARGIN_PX);
  });

  it('lifts the panel above its anchor when the anchor sits at the bottom of the window', () => {
    const placement = resolvePanelPlacement({
      anchor: { right: 900, bottom: 795 },
      ...PANEL,
      ...VIEWPORT,
    });
    expect(placement.top).toBe(VIEWPORT.viewportHeight - PANEL.panelHeight - VIEWPORT_MARGIN_PX);
    expect(placement.top).toBeLessThan(795);
  });

  it('keeps the panel under the anchor when there is room below it', () => {
    const placement = resolvePanelPlacement({
      anchor: { right: 900, bottom: 400 },
      ...PANEL,
      ...VIEWPORT,
    });
    expect(placement.top).toBeGreaterThan(400);
  });

  it('hangs the panel under the anchor when its height is unknown', () => {
    const placement = resolvePanelPlacement({
      anchor: { right: 900, bottom: 200 },
      panelWidth: PANEL.panelWidth,
      ...VIEWPORT,
    });
    expect(placement.top).toBe(200 + PANEL_GAP_PX);
  });

  it('falls back to the top margin when the window is shorter than the panel', () => {
    const placement = resolvePanelPlacement({
      anchor: { right: 900, bottom: 300 },
      ...PANEL,
      viewportWidth: 1280,
      viewportHeight: 200,
    });
    expect(placement.top).toBe(VIEWPORT_MARGIN_PX);
  });

  it('falls back to the left margin when the window is narrower than the panel', () => {
    const placement = resolvePanelPlacement({
      anchor: { right: 400, bottom: 100 },
      panelWidth: 600,
      panelHeight: 200,
      viewportWidth: 320,
      viewportHeight: 800,
    });
    expect(placement.left).toBe(VIEWPORT_MARGIN_PX);
  });

  it('leaves the position unrounded for the browser to place', () => {
    const placement = resolvePanelPlacement({
      anchor: { right: 640.5, bottom: 120.25 },
      ...PANEL,
      ...VIEWPORT,
    });
    expect(placement.top).toBe(120.25 + PANEL_GAP_PX);
    expect(placement.left).toBe(640.5 - PANEL.panelWidth);
  });
});
