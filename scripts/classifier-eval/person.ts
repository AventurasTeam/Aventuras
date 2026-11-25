// canon's "never 'I' or 'you' outside quoted speech", plural first person included.
const PERSON_WORD =
  /\b(?:i|me|my|mine|myself|we|us|our|ours|ourselves|you|your|yours|yourself|yourselves)\b/gi

// A straight pair, or a curly pair opening on “ and closing on ”; one left open runs to the end.
// Single quotes are apostrophes as often as quotes (Hask’s), so they never open one.
const QUOTED_SPEECH = /"[^"]*(?:"|$)|“[^”]*(?:”|$)/g

/** First- and second-person words in `text` outside quoted speech, in order of appearance. */
export function personWords(text: string): string[] {
  const unquoted = text.replace(QUOTED_SPEECH, ' ')
  return [...unquoted.matchAll(PERSON_WORD)]
    .map((match) => match[0])
    .filter((word) => word === 'I' || word.toLowerCase() !== 'i')
}
