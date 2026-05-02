import { ScrollView } from 'react-native'
import { ThemePicker } from './sections/theme-picker'
import { ColorSwatches } from './sections/color-swatches'
import { TypeRamp } from './sections/type-ramp'
import { SpacingDemo } from './sections/spacing-demo'
import { RadiusDemo } from './sections/radius-demo'
import { MotionSamples } from './sections/motion-samples'

export function FoundationsExplorer() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <ColorSwatches />
      <TypeRamp />
      <SpacingDemo />
      <RadiusDemo />
      <MotionSamples />
    </ScrollView>
  )
}
