/**
 * Every way an action modal can be asked to close, decided in one place.
 *
 * `sheet` is a close `vaul` has already carried out on its own: a swipe the guard did not catch,
 * or a tap on the handle, which `vaul` honours even on a sheet that is not dismissible.
 */
export type CloseSource = 'cancel' | 'escape' | 'outside' | 'sheet'

export type CloseOutcome =
  /** Nothing happens. */
  | 'ignore'
  /** The modal stays and asks whether to discard. */
  | 'ask'
  /** The question layer closes; the modal stays as it was. */
  | 'closeQuestion'
  /** The modal closes. */
  | 'close'
  /** The sheet `vaul` closed is brought back. */
  | 'return'
  /** The sheet `vaul` closed is brought back, asking whether to discard. */
  | 'returnAndAsk'

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
  const locked = state.busy && !state.cancelWhileBusy
  if (source === 'sheet') {
    if (locked) return 'return'
    return state.dirty || state.questionOpen ? 'returnAndAsk' : 'close'
  }
  if (locked) return 'ignore'
  // Cancel sits under the question, which makes the modal behind it inert.
  if (state.questionOpen) return source === 'cancel' ? 'ignore' : 'closeQuestion'
  return state.dirty ? 'ask' : 'close'
}
