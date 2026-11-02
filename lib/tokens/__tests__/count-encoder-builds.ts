import type { Tiktoken } from 'js-tiktoken/lite'
import { vi, type Mock } from 'vitest'

/**
 * A spy fired per encoder build. The encoder is module state, so it watches the fresh lib/tokens
 * the next dynamic import loads. Pair with `stopCountingEncoderBuilds` in an `afterEach`.
 */
export function countEncoderBuilds(): Mock<() => void> {
  const built = vi.fn<() => void>()
  vi.resetModules()
  vi.doMock('js-tiktoken/lite', async (importOriginal) => {
    const actual = await importOriginal<{ Tiktoken: typeof Tiktoken }>()
    class CountedTiktoken extends actual.Tiktoken {
      constructor(...args: ConstructorParameters<typeof Tiktoken>) {
        super(...args)
        built()
      }
    }
    return { ...actual, Tiktoken: CountedTiktoken }
  })
  return built
}

export function stopCountingEncoderBuilds(): void {
  vi.doUnmock('js-tiktoken/lite')
  vi.resetModules()
}
