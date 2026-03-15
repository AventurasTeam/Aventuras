export type SillyTavernCardV1 = {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
}

export type SillyTavernCardV2 = {
  spec: 'chara_card_v2' | 'chara_card_v3'
  spec_version: string
  data: SillyTavernCardV1 & {
    creator_notes?: string
    system_prompt?: string
    post_history_instructions?: string
    alternate_greetings?: string[]
    character_book?: unknown
    tags?: string[]
    creator?: string
    character_version?: string
    extensions?: Record<string, unknown>
  }
  name?: string
  description?: string
  personality?: string
  scenario?: string
  first_mes?: string
  mes_example?: string
  creator_notes?: string
  tags?: string[]
}

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
