import { Platform } from 'react-native'

type DescriptionProps = { 'aria-describedby'?: string; accessibilityHint?: string }

/**
 * Props that give a control a description read after its name. RN-web drops `accessibilityHint`,
 * so on web the description is the text of the elements `ids` names; native reads `text`.
 */
export function describedBy(ids: readonly string[], text: string): DescriptionProps {
  if (Platform.OS === 'web') return ids.length > 0 ? { 'aria-describedby': ids.join(' ') } : {}
  return text !== '' ? { accessibilityHint: text } : {}
}
