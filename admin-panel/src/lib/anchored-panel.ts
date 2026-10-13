export interface PanelAnchorRect {
  readonly right: number;
  readonly bottom: number;
}

export interface PanelPlacement {
  readonly top: number;
  readonly left: number;
}

/** Gap between the anchor control and the panel hanging under it. */
export const PANEL_GAP_PX = 8;

/** Keeps a clamped panel clear of the window edge rather than flush against it. */
export const VIEWPORT_MARGIN_PX = 12;

function clamp(value: number, lower: number, upper: number): number {
  // A window smaller than the panel inverts the bounds, so the lower bound has to win.
  return Math.max(lower, Math.min(value, Math.max(lower, upper)));
}

/**
 * Where a panel anchored under a control lands: right-aligned to the control and clamped
 * inside the window on both axes. The top is clamped as hard as the left, because a control
 * near the bottom of a short window would otherwise push its own panel off-screen.
 *
 * The height is optional: a caller that has not measured the panel can pass nothing and still
 * get a placement that hangs it under the control, which is right when its own styles cap it.
 */
export function resolvePanelPlacement(params: {
  anchor: PanelAnchorRect;
  panelWidth: number;
  panelHeight?: number;
  viewportWidth: number;
  viewportHeight: number;
}): PanelPlacement {
  const { anchor, panelWidth, viewportWidth, viewportHeight } = params;
  const panelHeight = params.panelHeight ?? 0;
  const left = clamp(
    anchor.right - panelWidth,
    VIEWPORT_MARGIN_PX,
    viewportWidth - panelWidth - VIEWPORT_MARGIN_PX,
  );
  const top = clamp(
    anchor.bottom + PANEL_GAP_PX,
    VIEWPORT_MARGIN_PX,
    viewportHeight - panelHeight - VIEWPORT_MARGIN_PX,
  );
  return { top, left };
}
