const IRREGULAR: Record<string, string> = {
  go: 'goes',
  have: 'has',
  do: 'does',
  be: 'is',
  try: 'tries',
}

const SIBILANT_ENDING = /(s|x|z|ch|sh)$/i
const CONSONANT_Y_ENDING = /[^aeiou]y$/i

function regularConjugation(lower: string): string {
  if (SIBILANT_ENDING.test(lower)) return `${lower}es`
  if (CONSONANT_Y_ENDING.test(lower)) return `${lower.slice(0, -1)}ies`
  return `${lower}s`
}

export function conjugateThirdPersonPresent(verb: string): string {
  const lower = verb.toLowerCase()
  const irregular = IRREGULAR[lower]
  const conjugated = irregular ?? regularConjugation(lower)
  if (verb[0] === verb[0]?.toUpperCase() && verb[0] !== verb[0]?.toLowerCase()) {
    return conjugated[0]!.toUpperCase() + conjugated.slice(1)
  }
  return conjugated
}
