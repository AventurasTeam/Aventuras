# Layout props on a compound trigger don't reach its wrapper element

Our `AccordionTrigger` renders
`AccordionPrimitive.Header` → `AccordionPrimitive.Trigger` (asChild)
→ `Pressable`, and the `className` a consumer passes lands on the
innermost `Pressable`. The element that actually participates in
the parent's flex row is the **Header**, which received no flex at
all. Passing `flex-1` to the trigger therefore styles a child of
the box that needed it.

**Symptom (native only).** Yoga collapses the trigger to zero
width: every label inside is clipped to invisibility and the
char-wrapped text stretches the row thousands of pixels tall.
Browsers forgive the same markup, because a flex item with no
`flex` still gets intrinsic `max-content` sizing — so the web build
and every Storybook story look perfect.

## The fix

Give the row a plain participant that owns the growth:

```tsx
<View className="flex-row items-center gap-3">
  <View className="min-w-0 flex-1">
    <AccordionTrigger>{/* … */}</AccordionTrigger>
  </View>
  <Button size="sm">{/* … */}</Button>
</View>
```

## How to apply

Before passing layout props (`flex-1`, `w-full`, `self-*`) to any
compound primitive, find which DOM/native element they land on and
which element is the flex child of your container. When those
differ, wrap instead of styling through. Grep the wrapper component
for a `Header`, `Root`, or `Portal` element sitting above the one
that receives `className`.

Corollary worth internalizing: **Storybook validates the web tree
only.** A layout that a browser rescues through intrinsic sizing
can collapse under Yoga, so a compound's first native consumer is
where these surface. When a component is about to be used on native
for the first time, treat "it looks right in Storybook" as no
evidence at all and check it on a device.

Related: [Substrate fragment layout leak](./substrate-fragment-layout-leak.md)
— the other case where a substrate's element structure leaks into
consumer layout.
