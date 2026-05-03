// Aventuras Icon primitive (Phase 2 partial — full Group E work pending).
//
// Reshape per docs/ui/components.md sourcing rules:
//
// - RESHAPED: default text color slot text-foreground → text-fg-primary
//   to match Aventuras's slot system. Inherits TextClassContext for
//   contextual color (e.g. inside a muted Text wrapper).
// - ACCEPTED: cssInterop wiring that maps NativeWind className width /
//   height to the lucide `size` prop, plus the `as={IconComponent}`
//   composition shape.
//
// NOT YET — pending Phase 2 Group E (Icon + Avatar):
//
// - Token-driven sizing slots (--icon-sm / --icon-md / --icon-lg).
// - Storybook stories.
// - Theme matrix coverage.
//
// Used by Select primitive (Phase 2 Group B); upcoming consumers will
// retrofit when Group E lands the full primitive.
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import type { LucideIcon, LucideProps } from 'lucide-react-native'
import { cssInterop } from 'nativewind'
import * as React from 'react'

type IconProps = LucideProps & {
  as: LucideIcon
} & React.RefAttributes<LucideIcon>

function IconImpl({ as: IconComponent, ...props }: IconProps) {
  return <IconComponent {...props} />
}

cssInterop(IconImpl, {
  className: {
    target: 'style',
    nativeStyleToProp: {
      height: 'size',
      width: 'size',
    },
  },
})

export function Icon({ as: IconComponent, className, size = 14, ...props }: IconProps) {
  const textClass = React.useContext(TextClassContext)
  return (
    <IconImpl
      as={IconComponent}
      className={cn('text-fg-primary', textClass, className)}
      size={size}
      {...props}
    />
  )
}
