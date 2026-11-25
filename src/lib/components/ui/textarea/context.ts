import { getContext, setContext } from 'svelte'

const UNCAPPED = Symbol('textarea-uncapped')

/** Lets autosizing textareas below grow without a height cap, for a container that scrolls them. */
export function setTextareaUncapped() {
  setContext(UNCAPPED, true)
}

export function isTextareaUncapped(): boolean {
  return getContext<boolean | undefined>(UNCAPPED) === true
}
