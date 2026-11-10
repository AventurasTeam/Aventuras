// A hand-edited row may hold anything in a JSON column; only strings are read.
export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
