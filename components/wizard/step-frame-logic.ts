export function needsLead(mode: string, narration: string): boolean {
  return mode === 'adventure' || narration === 'first' || narration === 'second'
}
