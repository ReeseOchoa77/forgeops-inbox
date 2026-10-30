/**
 * Desktop UI scale token.
 *
 * Laptop / MacBook viewports stay at 1. Larger CSS viewports grow modestly,
 * taking the minimum of width-based and height-based progress so a short
 * ultrawide window does not overscale. Capped so 4K does not become tablet-sized.
 *
 * Applied via CSS `var(--fo-ui-scale)` — never zoom/transform/JS screen math.
 */
export const FO_UI_SCALE_CSS_VAR = '--fo-ui-scale'

/** Width below this (CSS px) stays at the current laptop baseline. */
export const FO_UI_SCALE_WIDTH_START_PX = 1760
/** Height below this (CSS px) stays at the current laptop baseline. */
export const FO_UI_SCALE_HEIGHT_START_PX = 980
export const FO_UI_SCALE_WIDTH_RANGE_PX = 3200
export const FO_UI_SCALE_HEIGHT_RANGE_PX = 2200
export const FO_UI_SCALE_MAX = 1.12

export function computeUiScale(viewportWidthPx: number, viewportHeightPx: number): number {
  const byWidth =
    1 + (viewportWidthPx - FO_UI_SCALE_WIDTH_START_PX) / FO_UI_SCALE_WIDTH_RANGE_PX
  const byHeight =
    1 + (viewportHeightPx - FO_UI_SCALE_HEIGHT_START_PX) / FO_UI_SCALE_HEIGHT_RANGE_PX
  return Math.min(FO_UI_SCALE_MAX, Math.max(1, Math.min(byWidth, byHeight)))
}

/** CSS length that tracks `--fo-ui-scale`. Pass the current laptop-baseline px value. */
export function uiPx(px: number): string {
  if (px === 0) return '0'
  return `calc(${px}px * var(${FO_UI_SCALE_CSS_VAR}, 1))`
}
