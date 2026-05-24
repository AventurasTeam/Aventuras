# Image preview modal

Tap-thumbnail pattern: any inline image rendered at small size opens
a full-size preview modal. Universal across the app: small visual =
compressed glance, click = full fidelity.

Used by:

- Entity portraits in
  [World detail head](../screens/world/world.md#detail-head-structure)
  and the
  [Reader peek-drawer](../screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters).
- Asset thumbnails in the
  [World Assets tab](../screens/world/world.md#assets-involvements-history).
- Image-typed values in the raw JSON viewer (per
  [`data.md`](./data.md)).
- Any future surface that renders small images.

## Trigger

Any image rendered at < ~200 px on its longest edge. Larger
renderings (e.g., a hero portrait that already fills the detail-pane
head) don't need the affordance — the thumbnail-click pattern is
for "I want to see what's there at real size."

## Surface

Modal at every tier per
[`foundations/mobile/layout.md → Modal`](../foundations/mobile/layout.md#modal).
Modal centers the image at its natural size up to the viewport cap;
supports:

- Tap-to-dismiss on the backdrop.
- `Esc` on desktop.
- Drag-down on phone (Modal-not-Sheet because the image is the
  focus, not browse-and-pick).

## Cursor

`cursor: zoom-in` on hover for desktop. Phone has no hover state —
tap fires directly. Discoverability rests on the convention being
universal across the app, plus the standard per-affordance
always-visible rule from
[`icon-actions.md`](./icon-actions.md).

## Edit affordances stay separate

Click on the thumbnail = view full-size (read action). Edit /
replace / remove the image uses the icon-actions overlay (per
[`icon-actions.md`](./icon-actions.md)) on hover or
always-visible-muted at touch tier. Distinct gestures: tap the
image itself (view) versus tap the explicit icon (edit).

## No zoom-pan inside the modal in v1

The full-size preview is "fit to viewport"; image manipulation
(crop, zoom in further, pan) is parked. If real demand surfaces —
particularly for asset images at high resolution — extending the
modal to a full image viewer is a follow-up, not a contract
amendment.
