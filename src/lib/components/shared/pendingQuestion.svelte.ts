export interface Question {
  title: string
  description: string
  /** Defaults to "Keep editing". */
  keepLabel?: string
  /** Defaults to "Discard". */
  confirmLabel?: string
}

/** The question `DiscardConfirm` shows over a modal's content; one at a time. */
export class PendingQuestion {
  current = $state<Question | null>(null)
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
