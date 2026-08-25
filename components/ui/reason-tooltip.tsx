import type { ReactNode } from 'react'
import { Platform } from 'react-native'

type ReasonTooltipProps = {
  /** The explanation to surface; omit when there is nothing to explain. */
  reason?: string
  children: ReactNode
}

/**
 * Surfaces a control's explanatory reason as a web tooltip. No-op on native,
 * where the reason reaches assistive tech through the control's accessibility
 * hint. Most callers pass a disabled reason, but an enabled control with a
 * warning uses the same wrapper.
 *
 * Render this unconditionally and vary only `reason`: gating the wrapper itself
 * on the reason's presence changes the root element type, and React remounts
 * the control, dropping focus at the moment the state flips.
 *
 * `contents` generates no layout box, so over a `pointer-events: none` control
 * nothing catches the pointer — hence `inline-flex` while a reason exists. The
 * class-only change keeps the element, so the remount hazard above does not apply.
 */
function ReasonTooltip({ reason, children }: ReasonTooltipProps) {
  if (Platform.OS !== 'web') return children
  return (
    <div title={reason} className={reason ? 'inline-flex' : 'contents'}>
      {children}
    </div>
  )
}

export { ReasonTooltip }
export type { ReasonTooltipProps }
