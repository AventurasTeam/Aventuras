// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerKeyRepeatGuard } from './key-repeat-guard'

function press(target: Element, key: string, repeat: boolean): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

function release(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
}

describe('registerKeyRepeatGuard', () => {
  let unregister: () => void
  let opener: HTMLButtonElement
  let item: HTMLButtonElement
  const onItemKey = vi.fn()

  beforeEach(() => {
    opener = document.body.appendChild(document.createElement('button'))
    item = document.body.appendChild(document.createElement('button'))
    item.addEventListener('keydown', onItemKey)
    onItemKey.mockClear()
    unregister = registerKeyRepeatGuard()
  })

  afterEach(() => {
    unregister()
    document.body.replaceChildren()
  })

  it('drops an Enter repeat that lands on another element before any handler there sees it', () => {
    press(opener, 'Enter', false)
    const repeat = press(item, 'Enter', true)
    expect(repeat.defaultPrevented).toBe(true)
    expect(onItemKey).not.toHaveBeenCalled()
  })

  it('drops a Space repeat the same way', () => {
    press(opener, ' ', false)
    expect(press(item, ' ', true).defaultPrevented).toBe(true)
  })

  it('lets the repeats on the element the press began on through', () => {
    press(item, 'Enter', false)
    expect(press(item, 'Enter', true).defaultPrevented).toBe(false)
    expect(onItemKey).toHaveBeenCalledTimes(2)
  })

  it('takes a fresh press after the release wherever it lands', () => {
    press(opener, 'Enter', false)
    release(item, 'Enter')
    const fresh = press(item, 'Enter', false)
    expect(fresh.defaultPrevented).toBe(false)
    expect(press(item, 'Enter', true).defaultPrevented).toBe(false)
  })

  it('leaves other keys alone', () => {
    press(opener, 'ArrowDown', false)
    expect(press(item, 'ArrowDown', true).defaultPrevented).toBe(false)
  })

  it('stops guarding once unregistered', () => {
    unregister()
    press(opener, 'Enter', false)
    expect(press(item, 'Enter', true).defaultPrevented).toBe(false)
  })
})
