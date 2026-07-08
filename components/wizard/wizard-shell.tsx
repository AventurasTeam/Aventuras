import { type ReactNode, useEffect, useState } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type WizardShellProps = {
  /** 1-indexed active step; M2 only reaches 1 (Frame), 2 (Calendar), 5 (Opening). */
  step: number
  canGoNext: boolean
  isFinish: boolean
  /** Primary action is in flight (e.g. Finish committing); disables it against re-entry. */
  busy?: boolean
  onCancel: () => void
  onBack: () => void
  onNext: () => void
  onSaveDraft: () => void
  onJump: (step: number) => void
  /** Whether a given step's pill is jumpable from the current step (back always; forward only when visited + valid). */
  canJumpTo: (step: number) => boolean
  children: ReactNode
}

const STEP_ORDER = [1, 2, 3, 4, 5] as const

// M2 only wires steps 1 (Frame), 2 (Calendar), and 5 (Opening); World/Cast
// land in a later milestone and stay hard-disabled regardless of `step`.
const DISABLED_STEPS = new Set<number>([3, 4])

const STEP_LABEL_KEYS = {
  1: 'wizard:steps.frame',
  2: 'wizard:steps.calendar',
  3: 'wizard:steps.world',
  4: 'wizard:steps.cast',
  5: 'wizard:steps.opening',
} as const

// rn-primitives-disabled lesson: className-based pointer-events-none is
// unreliable on web; the inline style is the gate that actually blocks clicks.
const STATIC_STYLES = {
  pointerEventsNone: { pointerEvents: 'none' as const } satisfies ViewStyle,
  flex1: { flex: 1 } satisfies ViewStyle,
}

type PillState = 'active' | 'done' | 'pending'

function pillState(pillStep: number, activeStep: number): PillState {
  if (pillStep === activeStep) return 'active'
  if (pillStep < activeStep) return 'done'
  return 'pending'
}

type StepPillProps = {
  stepNumber: (typeof STEP_ORDER)[number]
  activeStep: number
  showLabel: boolean
  canJumpTo: (step: number) => boolean
  onJump: (step: number) => void
}

function StepPill({ stepNumber, activeStep, showLabel, canJumpTo, onJump }: StepPillProps) {
  const disabled = DISABLED_STEPS.has(stepNumber)
  const state = disabled ? 'pending' : pillState(stepNumber, activeStep)
  const label = t(STEP_LABEL_KEYS[stepNumber])
  const interactive = !disabled && canJumpTo(stepNumber)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !interactive, selected: state === 'active' }}
      disabled={!interactive}
      onPress={interactive ? () => onJump(stepNumber) : undefined}
      style={disabled ? STATIC_STYLES.pointerEventsNone : undefined}
      className={cn(
        'h-control-xs flex-row items-center gap-1.5 rounded-full border px-2.5',
        state === 'active' ? 'border-fg-primary bg-fg-primary' : 'border-border-strong bg-bg-base',
        interactive &&
          Platform.select({ web: 'cursor-pointer transition-colors hover:bg-tint-hover' }),
        disabled && 'opacity-50',
      )}
    >
      <View
        className={cn(
          'h-2 w-2 rounded-full border',
          state === 'active' && 'border-bg-base bg-bg-base',
          state === 'done' && 'border-fg-primary bg-fg-primary',
          state === 'pending' && 'border-fg-muted bg-transparent',
        )}
      />
      {showLabel ? (
        <Text size="xs" className={state === 'active' ? 'text-bg-base' : 'text-fg-muted'}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  )
}

export function WizardShell({
  step,
  canGoNext,
  isFinish,
  busy = false,
  onCancel,
  onBack,
  onNext,
  onSaveDraft,
  onJump,
  canJumpTo,
  children,
}: WizardShellProps) {
  const insets = useSafeAreaInsets()
  const tier = useTier()
  const isPhone = tier === 'phone'

  // Save bar on phone lesson (touch.md): the footer competes with composer
  // real estate while the soft keyboard is open, so it hides and reappears
  // with the keyboard rather than floating above it.
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  useEffect(() => {
    if (Platform.OS === 'web') return
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true))
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false))
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  const showFooter = !(isPhone && keyboardVisible)

  return (
    <View
      className="flex-1 bg-bg-base"
      style={{
        paddingTop: insets.top,
        paddingRight: insets.right,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
      }}
    >
      {/* Balanced side slots: the empty right View mirrors the Cancel button's
          flex weight so the content-sized title centers on the full header, not
          on the space left of the button. */}
      <View className="h-bar-md flex-row items-center border-b border-border bg-bg-base px-3">
        <View className="flex-1 items-start">
          <Button variant="secondary" size="sm" onPress={onCancel}>
            <Text>{t('wizard:topBar.cancel')}</Text>
          </Button>
        </View>
        <Text
          className="min-w-0 shrink px-2 font-semibold"
          size={isPhone ? 'sm' : 'base'}
          numberOfLines={1}
        >
          {t('wizard:topBar.title', { step })}
        </Text>
        <View className="flex-1" />
      </View>

      <View
        className={cn(
          'flex-row items-center justify-center border-b border-border bg-bg-base',
          isPhone ? 'gap-1.5 px-3 py-2' : 'gap-2 px-3 py-2.5',
        )}
      >
        {STEP_ORDER.map((n) => (
          <StepPill
            key={n}
            stepNumber={n}
            activeStep={step}
            showLabel={!isPhone}
            canJumpTo={canJumpTo}
            onJump={onJump}
          />
        ))}
      </View>

      <KeyboardAvoidingView
        style={STATIC_STYLES.flex1}
        behavior={
          Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined
        }
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName={isPhone ? 'p-4' : 'px-12 py-8'}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>

      {showFooter ? (
        <View
          className={cn(
            'flex-row items-center justify-between border-t border-border bg-bg-base',
            isPhone ? 'gap-2 px-3 py-2' : 'gap-2 px-4 py-3',
          )}
        >
          <Button variant="secondary" size="sm" onPress={onSaveDraft}>
            <Text>{t('wizard:footer.saveDraft')}</Text>
          </Button>
          <View className="flex-row items-center gap-2">
            {step !== 1 ? (
              <Button variant="secondary" size="sm" onPress={onBack}>
                <Text>{t('wizard:footer.back')}</Text>
              </Button>
            ) : null}
            <Button variant="primary" size="sm" onPress={onNext} disabled={!canGoNext || busy}>
              <Text>{isFinish ? t('wizard:footer.finish') : t('wizard:footer.next')}</Text>
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export type { WizardShellProps }
