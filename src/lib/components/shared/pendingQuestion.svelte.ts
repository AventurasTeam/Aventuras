import { AskedQuestion, type Question } from './askedQuestion'

export type { Question }

/** The question `DiscardConfirm` shows over a modal's content. */
export class PendingQuestion extends AskedQuestion {
  current = $state<Question | null>(null)
}
