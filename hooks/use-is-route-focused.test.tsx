// @vitest-environment jsdom
import { NavigationContext } from '@react-navigation/native'
import { act, cleanup, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useIsRouteFocused } from './use-is-route-focused'

// Stubbed at the module boundary: importing the real package reaches react-native's Flow
// source, which the unit project's bundler cannot parse. Only the context is needed.
vi.mock('@react-navigation/native', async () => {
  const { createContext } = await import('react')
  return { NavigationContext: createContext<unknown>(undefined) }
})

type Listener = () => void
type NavigationValue = ComponentProps<typeof NavigationContext.Provider>['value']

// Only the slice the hook touches; cast at the Provider, which wants a full NavigationProp.
function stubNavigation(initiallyFocused: boolean) {
  const listeners = new Map<string, Set<Listener>>()
  let focused = initiallyFocused
  return {
    isFocused: () => focused,
    addListener: vi.fn((event: string, cb: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(cb)
      listeners.set(event, set)
      return () => set.delete(cb)
    }),
    emit(event: 'focus' | 'blur') {
      focused = event === 'focus'
      act(() => listeners.get(event)?.forEach((cb) => cb()))
    },
    listenerCount: () => (listeners.get('focus')?.size ?? 0) + (listeners.get('blur')?.size ?? 0),
  }
}

function Probe() {
  return <span data-testid="focused">{String(useIsRouteFocused())}</span>
}

afterEach(cleanup)

describe('useIsRouteFocused', () => {
  it('reports focused with no navigator, instead of throwing like useIsFocused', () => {
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('focused').textContent).toBe('true')
  })

  it('tracks focus and blur while a navigator is present', () => {
    const navigation = stubNavigation(true)
    const { getByTestId } = render(
      <NavigationContext.Provider value={navigation as unknown as NavigationValue}>
        <Probe />
      </NavigationContext.Provider>,
    )
    expect(getByTestId('focused').textContent).toBe('true')

    navigation.emit('blur')
    expect(getByTestId('focused').textContent).toBe('false')

    navigation.emit('focus')
    expect(getByTestId('focused').textContent).toBe('true')
  })

  it('starts from the navigator state rather than assuming focused', () => {
    const navigation = stubNavigation(false)
    const { getByTestId } = render(
      <NavigationContext.Provider value={navigation as unknown as NavigationValue}>
        <Probe />
      </NavigationContext.Provider>,
    )
    expect(getByTestId('focused').textContent).toBe('false')
  })

  it('unsubscribes on unmount, so a popped screen stops answering', () => {
    const navigation = stubNavigation(true)
    const { unmount } = render(
      <NavigationContext.Provider value={navigation as unknown as NavigationValue}>
        <Probe />
      </NavigationContext.Provider>,
    )
    expect(navigation.listenerCount()).toBe(2)
    unmount()
    expect(navigation.listenerCount()).toBe(0)
  })
})
