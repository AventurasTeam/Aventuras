// Entry-ref columns hold a branch-scoped story-entries id or NULL; '' must
// collapse to NULL so absence reads correctly (e.g. the happenings
// occurred-vs-temporal CHECK treats '' as a present value).
export const nullifyRef = (v: string | null | undefined): string | null =>
  v == null || v === '' ? null : v
