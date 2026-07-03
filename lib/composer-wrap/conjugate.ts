const IRREGULAR: Record<string, string> = {
  go: 'goes',
  have: 'has',
  do: 'does',
  be: 'is',
  try: 'tries',
}

const SIBILANT_ENDING = /(s|x|z|ch|sh)$/i

export function conjugateThirdPersonPresent(verb: string): string {
  const lower = verb.toLowerCase()
  const irregular = IRREGULAR[lower]
  const conjugated = irregular ?? (SIBILANT_ENDING.test(lower) ? `${lower}es` : `${lower}s`)
  if (verb[0] === verb[0]?.toUpperCase() && verb[0] !== verb[0]?.toLowerCase()) {
    return conjugated[0]!.toUpperCase() + conjugated.slice(1)
  }
  return conjugated
}
