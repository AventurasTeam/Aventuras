# Preset authoring notes

Per-preset interpretation choices and authoring notes that don't
have a natural home inside the JSON definition itself.

## Tolkien canon — leap rule interpretation

The Shire preset's leap rule isn't fully pinned by canon. Appendix
D of _The Lord of the Rings_ says "every fourth year except the
last of a century," but the millennium-correction clause varies by
interpretation. This preset uses the simplest reading —
`{ every: 4 }, { every: 100, exclude }` — matching Earth Gregorian
without the 400-year exception. Edit the JSON if your reading
differs.
