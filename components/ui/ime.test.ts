import type { TextInputKeyPressEvent } from 'react-native'
import { describe, expect, it } from 'vitest'

import { isComposing } from './ime'

const press = (nativeEvent: Record<string, unknown>) =>
  ({ nativeEvent }) as unknown as TextInputKeyPressEvent

describe('isComposing', () => {
  it('takes an Enter flagged isComposing as composition', () => {
    expect(isComposing(press({ key: 'Enter', isComposing: true }))).toBe(true)
  })

  it("takes an IME's confirming Enter, key code 229 with isComposing false, as composition", () => {
    expect(isComposing(press({ key: 'Enter', keyCode: 229, isComposing: false }))).toBe(true)
  })

  it('takes a plain Enter, and a native event with neither signal, as no composition', () => {
    expect(isComposing(press({ key: 'Enter', keyCode: 13, isComposing: false }))).toBe(false)
    expect(isComposing(press({ key: 'Enter' }))).toBe(false)
  })
})
