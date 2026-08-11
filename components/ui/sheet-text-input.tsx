import { useBottomSheetInternal } from '@gorhom/bottom-sheet'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ComponentProps,
} from 'react'
import { findNodeHandle, TextInput } from 'react-native'

type TextInputProps = ComponentProps<typeof TextInput>

/**
 * The TextInput a `Sheet` swaps in, replacing gorhom's own
 * `BottomSheetTextInput`.
 *
 * gorhom's renders gesture-handler's `createNativeWrapper(TextInput)` rather
 * than React Native's, and a controlled value round-trip through that wrapper
 * loses caret position: deleting mid-string moves the caret an extra place
 * left. Only fields inside a sheet took that path, so it looked like a bug in
 * whichever screen happened to host one.
 *
 * What gorhom's component actually contributes is registration, not rendering —
 * the sheet has to know which node holds focus to translate itself above the
 * keyboard. That is reproduced here against the public `useBottomSheetInternal`
 * so the sheet keeps working, over React Native's TextInput so the caret does.
 */
const SheetTextInput = forwardRef<TextInput, TextInputProps>(
  ({ onFocus, onBlur, ...rest }, providedRef) => {
    const ref = useRef<TextInput>(null)
    const { animatedKeyboardState, textInputNodesRef } = useBottomSheetInternal()

    const handleFocus = useCallback<NonNullable<TextInputProps['onFocus']>>(
      (event) => {
        animatedKeyboardState.set((state) => ({ ...state, target: event.nativeEvent.target }))
        onFocus?.(event)
      },
      [onFocus, animatedKeyboardState],
    )

    const handleBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
      (event) => {
        // `currentlyFocusedInput()` is typed as a ReactNativeElement while
        // findNodeHandle still declares the legacy component union; gorhom hits
        // the same seam and re-exports RN's findNodeHandle unchanged.
        const focusedElsewhere = findNodeHandle(
          TextInput.State.currentlyFocusedInput() as unknown as Parameters<
            typeof findNodeHandle
          >[0],
        )
        // Only surrender the sheet's keyboard target if it was ours AND focus
        // did not just move to another field in the same sheet — otherwise a
        // field-to-field tap drops the sheet before the next focus raises it.
        const wasOurs = animatedKeyboardState.get().target === event.nativeEvent.target
        const movedWithinSheet =
          focusedElsewhere != null && textInputNodesRef.current.has(focusedElsewhere)
        if (wasOurs && !movedWithinSheet) {
          animatedKeyboardState.set((state) => ({ ...state, target: undefined }))
        }
        onBlur?.(event)
      },
      [onBlur, animatedKeyboardState, textInputNodesRef],
    )

    useEffect(() => {
      const node = findNodeHandle(ref.current)
      // Captured rather than re-read on cleanup, so unregistration removes
      // exactly the node that was registered even if the ref has since moved.
      const nodes = textInputNodesRef.current
      if (node == null) return
      nodes.add(node)
      return () => {
        if (animatedKeyboardState.get().target === node) {
          animatedKeyboardState.set((state) => ({ ...state, target: undefined }))
        }
        nodes.delete(node)
      }
    }, [textInputNodesRef, animatedKeyboardState])

    useImperativeHandle(providedRef, () => ref.current as TextInput, [])

    return <TextInput ref={ref} onFocus={handleFocus} onBlur={handleBlur} {...rest} />
  },
)
SheetTextInput.displayName = 'SheetTextInput'

export { SheetTextInput }
