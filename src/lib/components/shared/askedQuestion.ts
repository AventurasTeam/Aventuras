export interface Question {
  title: string
  description: string
  /** Defaults to "Keep editing". */
  keepLabel?: string
  /** Defaults to "Discard". */
  confirmLabel?: string
}

/**
 * One question at a time, asked and awaited. `current` is left to a subclass, so the reactive one
 * in `pendingQuestion.svelte.ts` can make it `$state`.
 */
export abstract class AskedQuestion {
  abstract current: Question | null
  #resolve: ((confirmed: boolean) => void) | null = null

  get open(): boolean {
    return this.current !== null
  }

  /** Resolves true when confirmed. An attempt made while a question is up gets false. */
  ask(question: Question): Promise<boolean> {
    if (this.current) return Promise.resolve(false)
    this.current = question
    return new Promise((resolve) => (this.#resolve = resolve))
  }

  answer(confirmed: boolean) {
    const resolve = this.#resolve
    this.current = null
    this.#resolve = null
    resolve?.(confirmed)
  }
}
