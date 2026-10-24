/** Every way an action modal can be asked to close, decided in one place. */
export type CloseSource = 'cancel' | 'escape' | 'outside'

export type CloseOutcome =
  /** Nothing happens. */
  | 'ignore'
  /** The modal stays and asks whether to discard. */
  | 'ask'
  /** The question layer closes; the modal stays as it was. */
  | 'closeQuestion'
  /** The modal closes. */
  | 'close'

export interface CloseState {
  /** The action is running. */
  busy: boolean
  /** Cancel stops the running action, so a running modal can still be left. */
  cancelWhileBusy: boolean
  /** The modal holds something that would be lost. */
  dirty: boolean
  /** The discard or removal question is showing. */
  questionOpen: boolean
}

export function decideClose(source: CloseSource, state: CloseState): CloseOutcome {
  if (state.busy && !state.cancelWhileBusy) return 'ignore'
  // Cancel sits under the question, which makes the modal behind it inert.
  if (state.questionOpen) return source === 'cancel' ? 'ignore' : 'closeQuestion'
  return state.dirty ? 'ask' : 'close'
}
