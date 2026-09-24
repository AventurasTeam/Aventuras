/**
 * A `#rgb` or `#rrggbb` colour, either case — the one shape stored accents and custom
 * swatches take. React-free so `lib/db` can share it with `lib/themes` and components.
 */
export const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
