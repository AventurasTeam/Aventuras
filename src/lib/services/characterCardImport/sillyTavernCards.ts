import type { SillyTavernCardV1, SillyTavernCardV2 } from './types'

export function isV2OrV3Card(data: unknown): data is SillyTavernCardV2 {
  if (typeof data !== 'object' || data === null) return false
  if (!('spec' in data) || !('data' in data)) return false
  const spec = (data as SillyTavernCardV2).spec
  return spec === 'chara_card_v2' || spec === 'chara_card_v3'
}

export function isV1Card(data: unknown): data is SillyTavernCardV1 {
  return (
    typeof data === 'object' &&
    data !== null &&
    'name' in data &&
    'description' in data &&
    !('spec' in data)
  )
}
