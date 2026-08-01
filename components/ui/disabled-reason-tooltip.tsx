import type { ReactNode } from 'react'
import { Platform } from 'react-native'

type DisabledReasonTooltipProps = {
  /** The explanation to surface; omit while the control is usable. */
  reason?: string
  children: ReactNode
}

/**
 * Surfaces a disabled control's reason as a web tooltip. No-op on native, where
 * the reason reaches assistive tech through the control's accessibility hint.
 *
 * Render this unconditionally and vary only `reason`: gating the wrapper itself
 * on the disabled state changes the root element type, and React remounts the
 * control, dropping focus at the moment the state flips.
 */
function DisabledReasonTooltip({ reason, children }: DisabledReasonTooltipProps) {
  if (Platform.OS !== 'web') return children
  return (
    <div title={reason} className="contents">
      {children}
    </div>
  )
}

export { DisabledReasonTooltip }
export type { DisabledReasonTooltipProps }
