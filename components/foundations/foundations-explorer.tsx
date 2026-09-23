import { ScrollView } from 'react-native'

import { ColorSwatches } from './sections/color-swatches'
import { MotionSamples } from './sections/motion-samples'
import { RadiusDemo } from './sections/radius-demo'
import { SpacingDemo } from './sections/spacing-demo'
import { ThemePicker } from './sections/theme-picker'
import { TypeRamp } from './sections/type-ramp'

export function FoundationsExplorer() {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 bg-bg-base">
      <ThemePicker />
      <ColorSwatches />
      <TypeRamp />
      <SpacingDemo />
      <RadiusDemo />
      <MotionSamples />
    </ScrollView>
  )
}
